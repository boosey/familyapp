/**
 * `listAlbumPhotoIds` (#371 — preload album thumbnails) — the lightweight ids-only album read used to
 * WARM thumbnail caches on hub load. It mirrors `listAlbumPhotosDetailed`'s authorization + ordering
 * exactly, but returns nothing but the photo ids (one query, no enrichment):
 *   - the viewer must hold an ACTIVE membership in a family to see its photos; unauthorized/unknown
 *     families are silently dropped (no leak). Anonymous ⇒ [].
 *   - each non-deleted photo placed in ANY authorized family appears ONCE (deduped), most-recent first;
 *     soft-deleted photos are excluded; capped at `opts.limit`.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlbumPhoto, listAlbumPhotoIds, type AuthContext } from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });
const anon: AuthContext = { kind: "anonymous" };

async function makeFamilyWithMember(name: string, contributorId: string): Promise<{ id: string }> {
  const fam = await makeFamily(db, name, contributorId);
  await addMembership(db, contributorId, fam.id, "active");
  return fam;
}

async function photoIn(familyIds: string[], contributorId: string, key: string) {
  return createAlbumPhoto(db, {
    contributorPersonId: contributorId,
    familyIds,
    source: "upload",
    storageKey: key,
  });
}

describe("listAlbumPhotoIds", () => {
  it("returns the member's photo ids, most-recent first", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const first = await photoIn([fam.id], rosa.id, "k/1");
    const second = await photoIn([fam.id], rosa.id, "k/2");
    await db
      .update(familyPhotos)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(familyPhotos.id, second.id));

    const ids = await listAlbumPhotoIds(db, account(rosa.id), [fam.id]);
    expect(ids).toEqual([second.id, first.id]);
  });

  it("is empty for a non-member (no leak) and for anonymous", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await photoIn([fam.id], rosa.id, "k/nm");

    expect(await listAlbumPhotoIds(db, account(outsider.id), [fam.id])).toEqual([]);
    expect(await listAlbumPhotoIds(db, anon, [fam.id])).toEqual([]);
  });

  it("dedupes a photo placed in two authorized families", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const photo = await photoIn([famA.id, famB.id], rosa.id, "k/dup");

    const ids = await listAlbumPhotoIds(db, account(rosa.id), [famA.id, famB.id]);
    expect(ids).toEqual([photo.id]);
  });

  it("silently drops a family the viewer isn't a member of", async () => {
    const rosa = await makePerson(db, "Rosa");
    const other = await makePerson(db, "Other");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamily(db, "Carney", other.id); // rosa NOT a member
    await addMembership(db, other.id, famB.id, "active");
    const inA = await photoIn([famA.id], rosa.id, "k/a");
    await photoIn([famB.id], other.id, "k/b"); // only in famB — must not leak to rosa

    const ids = await listAlbumPhotoIds(db, account(rosa.id), [famA.id, famB.id]);
    expect(ids).toEqual([inA.id]);
  });

  it("excludes soft-deleted photos", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const kept = await photoIn([fam.id], rosa.id, "k/keep");
    const gone = await photoIn([fam.id], rosa.id, "k/gone");
    await db
      .update(familyPhotos)
      .set({ deletedAt: new Date() })
      .where(eq(familyPhotos.id, gone.id));

    const ids = await listAlbumPhotoIds(db, account(rosa.id), [fam.id]);
    expect(ids).toEqual([kept.id]);
  });

  it("caps at opts.limit, keeping the most-recent distinct photos", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      // Placed in BOTH families → two placement rows apiece; the cap counts DISTINCT photos.
      const p = await photoIn([famA.id, famB.id], rosa.id, `k/cap-${i}`);
      await db
        .update(familyPhotos)
        .set({ createdAt: new Date(base + i * 60_000) })
        .where(eq(familyPhotos.id, p.id));
      ids.push(p.id);
    }
    const got = await listAlbumPhotoIds(db, account(rosa.id), [famA.id, famB.id], { limit: 2 });
    expect(got).toEqual([ids[2], ids[1]]);
  });

  it("returns [] when no families are requested", async () => {
    const rosa = await makePerson(db, "Rosa");
    await makeFamilyWithMember("Esposito", rosa.id);
    expect(await listAlbumPhotoIds(db, account(rosa.id), [])).toEqual([]);
  });
});
