/**
 * Album repository (ADR-0009 · #15) — the guarded write + read seam for `family_photos` /
 * `family_photo_families`. These tests pin the album's authorization model, which is simpler than a
 * Story's: a photo has a CONTRIBUTOR (not an owner) and "being in a family's album IS the
 * contributor's consent for that family to see it". So visibility = the viewer holds an ACTIVE
 * membership in ANY family the (non-deleted) photo is placed in. No consent ledger, no audience tier.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAlbumPhotoRead,
  createAlbumPhoto,
  getAlbumPhotoForViewer,
  listAlbumPhotos,
  type AuthContext,
} from "../src/index";
import { addMembership, endMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });
const anon: AuthContext = { kind: "anonymous" };

/**
 * A family plus the contributor's ACTIVE membership in it — the realistic setup: the upload flow
 * resolves the contributor's target family FROM their own active memberships, so a contributor is
 * always an active member of a family they place a photo in. The album has no owner-bypass; access
 * is membership-based, so the contributor needs a membership to see their own album.
 */
async function makeFamilyWithMember(
  name: string,
  contributorId: string,
): Promise<{ id: string }> {
  const fam = await makeFamily(db, name, contributorId);
  await addMembership(db, contributorId, fam.id, "active");
  return fam;
}

/** Soft-delete a photo the way the (future) delete path will: set deleted_at. */
async function softDelete(photoId: string): Promise<void> {
  await db
    .update(familyPhotos)
    .set({ deletedAt: new Date() })
    .where(eq(familyPhotos.id, photoId));
}

describe("createAlbumPhoto", () => {
  it("writes the photo row plus one membership row per target family", async () => {
    const contributor = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", contributor.id);
    const famB = await makeFamilyWithMember("Carney", contributor.id);

    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [famA.id, famB.id],
      source: "upload",
      storageKey: "family-photos/abc",
      caption: "Wedding, 1961",
    });

    expect(photo.contributorPersonId).toBe(contributor.id);
    expect(photo.source).toBe("upload");
    expect(photo.storageKey).toBe("family-photos/abc");
    expect(photo.caption).toBe("Wedding, 1961");
    // #15 leaves EXIF null (populated by #17); the columns exist as the shared contract.
    expect(photo.exifCapturedAt).toBeNull();
    expect(photo.exifGps).toBeNull();
    expect(photo.deletedAt).toBeNull();

    // Two membership rows — visible from each targeted family.
    const forA = await listAlbumPhotos(db, account(contributor.id), famA.id);
    const forB = await listAlbumPhotos(db, account(contributor.id), famB.id);
    expect(forA.map((p) => p.id)).toEqual([photo.id]);
    expect(forB.map((p) => p.id)).toEqual([photo.id]);
  });

  it("defaults caption/exif to null when omitted", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/no-caption",
    });
    expect(photo.caption).toBeNull();
    expect(photo.exifCapturedAt).toBeNull();
    expect(photo.exifGps).toBeNull();
  });

  it("rejects a photo targeted to zero families (a photo must live in an album)", async () => {
    const contributor = await makePerson(db, "Rosa");
    await expect(
      createAlbumPhoto(db, {
        contributorPersonId: contributor.id,
        familyIds: [],
        source: "upload",
        storageKey: "family-photos/orphan",
      }),
    ).rejects.toThrow();
  });
});

describe("listAlbumPhotos", () => {
  it("returns a family's photos, recency desc, for an active member", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const first = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/first",
    });
    const second = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/second",
    });
    const view = await listAlbumPhotos(db, account(contributor.id), fam.id);
    // Newest first.
    expect(view.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(view[0]!.storageKey).toBe("family-photos/second");
  });

  it("lets a co-member (not the contributor) see the album", async () => {
    const contributor = await makePerson(db, "Rosa");
    const coMember = await makePerson(db, "Sal");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    await addMembership(db, coMember.id, fam.id, "active");
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/shared",
    });
    const view = await listAlbumPhotos(db, account(coMember.id), fam.id);
    expect(view.map((p) => p.id)).toEqual([photo.id]);
  });

  it("returns empty for a non-member of the family", async () => {
    const contributor = await makePerson(db, "Rosa");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/private-album",
    });
    expect(await listAlbumPhotos(db, account(stranger.id), fam.id)).toEqual([]);
    expect(await listAlbumPhotos(db, anon, fam.id)).toEqual([]);
  });

  it("returns empty once the viewer's membership is ended", async () => {
    const contributor = await makePerson(db, "Rosa");
    const former = await makePerson(db, "Former");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const membership = await addMembership(db, former.id, fam.id, "active");
    await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/left",
    });
    expect((await listAlbumPhotos(db, account(former.id), fam.id)).length).toBe(1);
    await endMembership(db, membership.id);
    expect(await listAlbumPhotos(db, account(former.id), fam.id)).toEqual([]);
  });

  it("excludes soft-deleted photos", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const kept = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/kept",
    });
    const gone = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/gone",
    });
    await softDelete(gone.id);
    const view = await listAlbumPhotos(db, account(contributor.id), fam.id);
    expect(view.map((p) => p.id)).toEqual([kept.id]);
  });
});

describe("authorizeAlbumPhotoRead", () => {
  it("ALLOWs a member and DENYs a stranger", async () => {
    const contributor = await makePerson(db, "Rosa");
    const coMember = await makePerson(db, "Sal");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    await addMembership(db, coMember.id, fam.id, "active");
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/auth",
    });

    expect((await authorizeAlbumPhotoRead(db, account(contributor.id), photo.id)).allowed).toBe(true);
    expect((await authorizeAlbumPhotoRead(db, account(coMember.id), photo.id)).allowed).toBe(true);
    expect((await authorizeAlbumPhotoRead(db, account(stranger.id), photo.id)).allowed).toBe(false);
    expect((await authorizeAlbumPhotoRead(db, anon, photo.id)).allowed).toBe(false);
  });

  it("DENYs a read of a soft-deleted photo (treated as absent)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/soft-deleted",
    });
    await softDelete(photo.id);
    expect((await authorizeAlbumPhotoRead(db, account(contributor.id), photo.id)).allowed).toBe(false);
  });

  it("DENYs a read of a non-existent photo", async () => {
    const contributor = await makePerson(db, "Rosa");
    const decision = await authorizeAlbumPhotoRead(
      db,
      account(contributor.id),
      "00000000-0000-0000-0000-000000000000",
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("multi-family album placement (shared contract for #16)", () => {
  it("a photo in two families is visible from EACH, to that family's members only", async () => {
    const contributor = await makePerson(db, "Rosa");
    const carneyMember = await makePerson(db, "Carney cousin");
    const espositoMember = await makePerson(db, "Esposito cousin");
    const famEsposito = await makeFamilyWithMember("Esposito", contributor.id);
    const famCarney = await makeFamilyWithMember("Carney", contributor.id);
    await addMembership(db, espositoMember.id, famEsposito.id, "active");
    await addMembership(db, carneyMember.id, famCarney.id, "active");

    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [famEsposito.id, famCarney.id],
      source: "upload",
      storageKey: "family-photos/wedding",
    });

    // Each family's own member sees it via that family.
    expect((await listAlbumPhotos(db, account(espositoMember.id), famEsposito.id)).map((p) => p.id)).toEqual([photo.id]);
    expect((await listAlbumPhotos(db, account(carneyMember.id), famCarney.id)).map((p) => p.id)).toEqual([photo.id]);

    // The Esposito member is NOT in Carney → cannot list the Carney album...
    expect(await listAlbumPhotos(db, account(espositoMember.id), famCarney.id)).toEqual([]);
    // ...but CAN read the shared photo's bytes, because they share the Esposito album with it.
    expect((await authorizeAlbumPhotoRead(db, account(espositoMember.id), photo.id)).allowed).toBe(true);
    expect((await authorizeAlbumPhotoRead(db, account(carneyMember.id), photo.id)).allowed).toBe(true);
  });
});

describe("getAlbumPhotoForViewer (bytes-route front door)", () => {
  it("returns the row (with storageKey) for an authorized viewer, null otherwise", async () => {
    const contributor = await makePerson(db, "Rosa");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/bytes",
    });

    const forOwner = await getAlbumPhotoForViewer(db, account(contributor.id), photo.id);
    expect(forOwner?.storageKey).toBe("family-photos/bytes");
    expect(await getAlbumPhotoForViewer(db, account(stranger.id), photo.id)).toBeNull();
  });
});
