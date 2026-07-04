/**
 * Album repository (ADR-0009 · #15) — the guarded write + read seam for `family_photos` /
 * `family_photo_families`. These tests pin the album's authorization model, which is simpler than a
 * Story's: a photo has a CONTRIBUTOR (not an owner) and "being in a family's album IS the
 * contributor's consent for that family to see it". So visibility = the viewer holds an ACTIVE
 * membership in ANY family the (non-deleted) photo is placed in. No consent ledger, no audience tier.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos } from "@chronicle/db/content";
import { consentRecords } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  attachPhotoToStory,
  authorizeAlbumPhotoRead,
  createAlbumPhoto,
  getAlbumPhotoForViewer,
  listAlbumPhotos,
  setAlbumPhotoCaption,
  softDeleteAlbumPhoto,
  type AuthContext,
} from "../src/index";
import {
  addMembership,
  endMembership,
  makeFamily,
  makePerson,
  makeStory,
} from "./helpers";

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

/**
 * A family whose STEWARD is a distinct person from the contributor, with everyone an active member —
 * the realistic moderation setup for #18: the steward (family creator) can manage another member's
 * photo; a plain member cannot. `makeFamily(db, name, stewardId)` stamps stewardId as the steward.
 */
async function makeStewardedFamily(
  name: string,
  stewardId: string,
  ...memberIds: string[]
): Promise<{ id: string }> {
  const fam = await makeFamily(db, name, stewardId);
  await addMembership(db, stewardId, fam.id, "active");
  for (const id of memberIds) await addMembership(db, id, fam.id, "active");
  return fam;
}

describe("setAlbumPhotoCaption", () => {
  it("lets the contributor set, change, and clear a caption (last-write-wins)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/cap",
    });

    // Set.
    const set = await setAlbumPhotoCaption(db, account(contributor.id), photo.id, "Wedding, 1961");
    expect(set.allowed).toBe(true);
    expect((await listAlbumPhotos(db, account(contributor.id), fam.id))[0]!.caption).toBe(
      "Wedding, 1961",
    );
    expect((await getAlbumPhotoForViewer(db, account(contributor.id), photo.id))!.caption).toBe(
      "Wedding, 1961",
    );

    // Change (last write wins).
    await setAlbumPhotoCaption(db, account(contributor.id), photo.id, "  Wedding day  ");
    expect((await listAlbumPhotos(db, account(contributor.id), fam.id))[0]!.caption).toBe(
      "Wedding day", // trimmed
    );

    // Clear with null.
    await setAlbumPhotoCaption(db, account(contributor.id), photo.id, null);
    expect((await listAlbumPhotos(db, account(contributor.id), fam.id))[0]!.caption).toBeNull();

    // Clear with whitespace-only.
    await setAlbumPhotoCaption(db, account(contributor.id), photo.id, "again");
    await setAlbumPhotoCaption(db, account(contributor.id), photo.id, "   ");
    expect((await listAlbumPhotos(db, account(contributor.id), fam.id))[0]!.caption).toBeNull();
  });

  it("lets a steward of a placed-in family caption another member's photo", async () => {
    const steward = await makePerson(db, "Nonna");
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeStewardedFamily("Esposito", steward.id, contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/steward-cap",
    });

    const decision = await setAlbumPhotoCaption(db, account(steward.id), photo.id, "Nonna's note");
    expect(decision.allowed).toBe(true);
    expect((await listAlbumPhotos(db, account(steward.id), fam.id))[0]!.caption).toBe(
      "Nonna's note",
    );
  });

  it("DENYs a plain member (not contributor, not steward) and leaves the caption unchanged", async () => {
    const steward = await makePerson(db, "Nonna");
    const contributor = await makePerson(db, "Rosa");
    const member = await makePerson(db, "Sal");
    const fam = await makeStewardedFamily("Esposito", steward.id, contributor.id, member.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/member-cap",
      caption: "Original",
    });

    const decision = await setAlbumPhotoCaption(db, account(member.id), photo.id, "Hijacked");
    expect(decision.allowed).toBe(false);
    expect((await listAlbumPhotos(db, account(member.id), fam.id))[0]!.caption).toBe("Original");
  });

  it("DENYs a non-member and an anonymous viewer", async () => {
    const contributor = await makePerson(db, "Rosa");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/nonmember-cap",
      caption: "Original",
    });

    expect((await setAlbumPhotoCaption(db, account(stranger.id), photo.id, "x")).allowed).toBe(false);
    expect((await setAlbumPhotoCaption(db, anon, photo.id, "x")).allowed).toBe(false);
    expect((await listAlbumPhotos(db, account(contributor.id), fam.id))[0]!.caption).toBe("Original");
  });

  it("writes NO consent_records row (caption is off-ledger)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/ledger-cap",
    });

    const before = (await db.select().from(consentRecords)).length;
    await setAlbumPhotoCaption(db, account(contributor.id), photo.id, "Off the ledger");
    const after = (await db.select().from(consentRecords)).length;
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it("DENYs captioning an absent photo", async () => {
    const contributor = await makePerson(db, "Rosa");
    const decision = await setAlbumPhotoCaption(
      db,
      account(contributor.id),
      "00000000-0000-0000-0000-000000000000",
      "x",
    );
    expect(decision.allowed).toBe(false);
  });

  it("DENYs captioning a soft-deleted photo (treated as absent, caption unchanged)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/del-then-cap",
      caption: "Before delete",
    });
    expect((await softDeleteAlbumPhoto(db, account(contributor.id), photo.id)).allowed).toBe(true);

    const decision = await setAlbumPhotoCaption(
      db,
      account(contributor.id),
      photo.id,
      "After delete",
    );
    expect(decision.allowed).toBe(false);
    // The caption is unchanged — read the raw row (listAlbumPhotos excludes soft-deleted rows).
    const [row] = await db
      .select({ caption: familyPhotos.caption })
      .from(familyPhotos)
      .where(eq(familyPhotos.id, photo.id));
    expect(row!.caption).toBe("Before delete");
  });
});

describe("softDeleteAlbumPhoto", () => {
  it("lets the contributor soft-delete a multi-family photo, removing it from ALL its albums", async () => {
    const contributor = await makePerson(db, "Rosa");
    const espositoMember = await makePerson(db, "Esposito cousin");
    const carneyMember = await makePerson(db, "Carney cousin");
    const famA = await makeFamilyWithMember("Esposito", contributor.id);
    const famB = await makeFamilyWithMember("Carney", contributor.id);
    await addMembership(db, espositoMember.id, famA.id, "active");
    await addMembership(db, carneyMember.id, famB.id, "active");
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [famA.id, famB.id],
      source: "upload",
      storageKey: "family-photos/multi-del",
    });

    const decision = await softDeleteAlbumPhoto(db, account(contributor.id), photo.id);
    expect(decision.allowed).toBe(true);

    // Gone from BOTH families' albums.
    expect(await listAlbumPhotos(db, account(espositoMember.id), famA.id)).toEqual([]);
    expect(await listAlbumPhotos(db, account(carneyMember.id), famB.id)).toEqual([]);
    // And the bytes/read front door now treats it as absent.
    expect(await getAlbumPhotoForViewer(db, account(contributor.id), photo.id)).toBeNull();
    expect((await authorizeAlbumPhotoRead(db, account(contributor.id), photo.id)).allowed).toBe(
      false,
    );
  });

  it("lets the steward of ONE placed-in family caption AND delete a photo also placed in another family", async () => {
    // Cross-family moderation: a photo lives in famA and famB. famB's steward is NOT a member of
    // famA and NOT famA's steward — yet, because the photo is placed in famB, they may manage it,
    // and an authorized delete removes it from BOTH albums (single shared row). This pins the
    // "steward-of-B can act on a photo also in A" semantic the issue asked to confirm.
    const contributor = await makePerson(db, "Rosa");
    const stewardA = await makePerson(db, "Nonna A");
    const stewardB = await makePerson(db, "Nonno B");
    const famA = await makeFamily(db, "Esposito", stewardA.id); // steward = stewardA
    const famB = await makeFamily(db, "Carney", stewardB.id); // steward = stewardB
    // The contributor is a member of both, so they can observe both albums; stewardB is a member of
    // neither famA nor (necessarily) anything relevant — their authority comes purely from famB's stewardship.
    await addMembership(db, contributor.id, famA.id, "active");
    await addMembership(db, contributor.id, famB.id, "active");
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [famA.id, famB.id],
      source: "upload",
      storageKey: "family-photos/xfam-steward",
    });

    // famB's steward can caption it (it's placed in a family they steward), even though it also lives in famA.
    const cap = await setAlbumPhotoCaption(db, account(stewardB.id), photo.id, "Cross-family note");
    expect(cap.allowed).toBe(true);
    expect((await listAlbumPhotos(db, account(contributor.id), famA.id))[0]!.caption).toBe(
      "Cross-family note",
    );

    // ...and can delete it, removing it from BOTH famA's and famB's albums.
    const del = await softDeleteAlbumPhoto(db, account(stewardB.id), photo.id);
    expect(del.allowed).toBe(true);
    expect(await listAlbumPhotos(db, account(contributor.id), famA.id)).toEqual([]);
    expect(await listAlbumPhotos(db, account(contributor.id), famB.id)).toEqual([]);
  });

  it("lets a steward of a placed-in family delete another member's photo", async () => {
    const steward = await makePerson(db, "Nonna");
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeStewardedFamily("Esposito", steward.id, contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/steward-del",
    });

    const decision = await softDeleteAlbumPhoto(db, account(steward.id), photo.id);
    expect(decision.allowed).toBe(true);
    expect(await listAlbumPhotos(db, account(steward.id), fam.id)).toEqual([]);
  });

  it("DENYs a plain member / non-member / anonymous; the photo stays (deletedAt null, still listed)", async () => {
    const steward = await makePerson(db, "Nonna");
    const contributor = await makePerson(db, "Rosa");
    const member = await makePerson(db, "Sal");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeStewardedFamily("Esposito", steward.id, contributor.id, member.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/guarded-del",
    });

    expect((await softDeleteAlbumPhoto(db, account(member.id), photo.id)).allowed).toBe(false);
    expect((await softDeleteAlbumPhoto(db, account(stranger.id), photo.id)).allowed).toBe(false);
    expect((await softDeleteAlbumPhoto(db, anon, photo.id)).allowed).toBe(false);

    const [row] = await db
      .select({ deletedAt: familyPhotos.deletedAt })
      .from(familyPhotos)
      .where(eq(familyPhotos.id, photo.id));
    expect(row!.deletedAt).toBeNull();
    expect((await listAlbumPhotos(db, account(member.id), fam.id)).map((p) => p.id)).toEqual([
      photo.id,
    ]);
  });

  it("DENYs deleting an already-deleted or absent photo (idempotent-guarded)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", contributor.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/twice-del",
    });

    expect((await softDeleteAlbumPhoto(db, account(contributor.id), photo.id)).allowed).toBe(true);
    // A second delete is DENIED (already deleted → treated as absent).
    expect((await softDeleteAlbumPhoto(db, account(contributor.id), photo.id)).allowed).toBe(false);
    // A wholly absent id is DENIED.
    expect(
      (
        await softDeleteAlbumPhoto(
          db,
          account(contributor.id),
          "00000000-0000-0000-0000-000000000000",
        )
      ).allowed,
    ).toBe(false);
  });
});

/**
 * ADR-0009 §Authorization — the BROADENED photo-byte read. Photo visibility is the UNION of
 * (album memberships) ∪ (audience of any VISIBLE story the photo is attached to). A photo the viewer
 * is NOT an album-member of becomes readable once it is attached to a story that viewer can read;
 * a `private` story leaks nothing; a soft-deleted photo stays absent regardless of attachment.
 */
describe("decideAlbumPhotoRead — accompaniment arm (ADR-0009 story audience)", () => {
  it("a family-story attachment makes the photo readable to that story's audience (not just album members)", async () => {
    const owner = await makePerson(db, "Nonna");
    const viewer = await makePerson(db, "Grandchild");
    // The photo's album family — the viewer is NOT a member, so album membership alone denies them.
    const famAlbum = await makeFamilyWithMember("Private album", owner.id);
    // A family both owner and viewer share — the story is targeted here.
    const famShared = await makeFamily(db, "Shared", owner.id);
    await addMembership(db, owner.id, famShared.id, "active");
    await addMembership(db, viewer.id, famShared.id, "active");

    const photo = await createAlbumPhoto(db, {
      contributorPersonId: owner.id,
      familyIds: [famAlbum.id],
      source: "upload",
      storageKey: "family-photos/accompaniment-family",
    });

    // Before attaching: the viewer shares no album family with the photo → DENY.
    expect((await authorizeAlbumPhotoRead(db, account(viewer.id), photo.id)).allowed).toBe(false);

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [famShared.id],
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: owner.id,
    });

    // After attaching to a family story the viewer may read → the photo bytes serve to them.
    expect((await authorizeAlbumPhotoRead(db, account(viewer.id), photo.id)).allowed).toBe(true);
    expect((await getAlbumPhotoForViewer(db, account(viewer.id), photo.id))?.id).toBe(photo.id);
  });

  it("a public-story attachment makes the photo readable to ANYONE, including anon", async () => {
    const owner = await makePerson(db, "Nonna");
    const stranger = await makePerson(db, "Stranger");
    const famAlbum = await makeFamilyWithMember("Private album", owner.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: owner.id,
      familyIds: [famAlbum.id],
      source: "upload",
      storageKey: "family-photos/accompaniment-public",
    });

    // Anon and a stranger cannot read it via the album.
    expect((await authorizeAlbumPhotoRead(db, anon, photo.id)).allowed).toBe(false);
    expect((await authorizeAlbumPhotoRead(db, account(stranger.id), photo.id)).allowed).toBe(false);

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: owner.id,
    });

    // A public story serves its imagery to everyone.
    expect((await authorizeAlbumPhotoRead(db, anon, photo.id)).allowed).toBe(true);
    expect((await authorizeAlbumPhotoRead(db, account(stranger.id), photo.id)).allowed).toBe(true);
  });

  it("a photo attached ONLY to a private story is NOT readable by a non-owner", async () => {
    const owner = await makePerson(db, "Nonna");
    const viewer = await makePerson(db, "Outsider");
    const famAlbum = await makeFamilyWithMember("Private album", owner.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: owner.id,
      familyIds: [famAlbum.id],
      source: "upload",
      storageKey: "family-photos/accompaniment-private",
    });

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "draft",
      audienceTier: "private",
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: owner.id,
    });

    // The owner still reads it (album membership); the private story leaks nothing to the outsider.
    expect((await authorizeAlbumPhotoRead(db, account(owner.id), photo.id)).allowed).toBe(true);
    expect((await authorizeAlbumPhotoRead(db, account(viewer.id), photo.id)).allowed).toBe(false);
    expect((await authorizeAlbumPhotoRead(db, anon, photo.id)).allowed).toBe(false);
  });

  it("a soft-deleted photo stays unreadable even when attached to a public story", async () => {
    const owner = await makePerson(db, "Nonna");
    const famAlbum = await makeFamilyWithMember("Private album", owner.id);
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: owner.id,
      familyIds: [famAlbum.id],
      source: "upload",
      storageKey: "family-photos/accompaniment-deleted",
    });
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: owner.id,
    });
    await softDelete(photo.id);

    // Absent (soft-deleted) ⇒ DENY to everyone, story audience included — even the owner.
    expect((await authorizeAlbumPhotoRead(db, anon, photo.id)).allowed).toBe(false);
    expect((await authorizeAlbumPhotoRead(db, account(owner.id), photo.id)).allowed).toBe(false);
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
