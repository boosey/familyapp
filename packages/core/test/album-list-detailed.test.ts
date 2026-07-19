/**
 * `listAlbumPhotosDetailed` (album enhancements, Phase C) — the enriched + deduped List-view read
 * across many family albums. The authorization model under test mirrors `listAlbumPhotos`:
 *   - the viewer must hold an ACTIVE membership in a family to see its photos; any requested family
 *     the viewer isn't in is silently ignored (no leak). Anonymous ⇒ [].
 *   - each non-deleted photo placed in ANY authorized family is returned ONCE (deduped by id),
 *     most-recent first; soft-deleted photos are excluded.
 *   - each row carries contributor name, its AUTHORIZED placements, and its subject/people/place tags.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos } from "@chronicle/db/content";
import { families } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAlbumPhoto,
  listAlbumPhotosDetailed,
  tagPhotoPerson,
  tagPhotoPlace,
  tagPhotoSubject,
  type AuthContext,
} from "../src/index";
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

describe("listAlbumPhotosDetailed", () => {
  it("returns families, subjects, people, places, and contributor for a member", async () => {
    const rosa = await makePerson(db, "Rosa");
    const sal = await makePerson(db, "Salvatore");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await addMembership(db, sal.id, fam.id, "active");
    const photo = await photoIn([fam.id], rosa.id, "k/a");

    await tagPhotoSubject(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    await tagPhotoPerson(db, account(rosa.id), { photoId: photo.id, personId: sal.id });
    await tagPhotoPlace(db, account(rosa.id), { photoId: photo.id, newPlaceName: "Naples" });

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [fam.id]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(photo.id);
    expect(row.contributorPersonId).toBe(rosa.id);
    expect(row.contributorDisplayName).toBe("Rosa");
    expect(row.families).toEqual([
      { familyId: fam.id, familyName: "Esposito", familyShortName: null },
    ]);
    expect(row.subjects.map((s) => s.personId)).toEqual([rosa.id]);
    expect(row.subjects[0]!.displayName).toBe("Rosa");
    expect(row.people.map((p) => p.personId)).toEqual([sal.id]);
    expect(row.places.map((p) => p.name)).toEqual(["Naples"]);
  });

  it("carries capturedAt from exif and null when absent", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const when = new Date("1961-06-01T12:00:00.000Z");
    const withExif = await createAlbumPhoto(db, {
      contributorPersonId: rosa.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "k/exif",
      exifCapturedAt: when,
    });
    const withoutExif = await photoIn([fam.id], rosa.id, "k/noexif");

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [fam.id]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(withExif.id)!.capturedAt?.getTime()).toBe(when.getTime());
    expect(byId.get(withoutExif.id)!.capturedAt).toBeNull();
  });

  it("is empty for a non-member (no leak) and for anonymous", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await photoIn([fam.id], rosa.id, "k/nm");

    expect(await listAlbumPhotosDetailed(db, account(outsider.id), [fam.id])).toEqual([]);
    expect(await listAlbumPhotosDetailed(db, anon, [fam.id])).toEqual([]);
  });

  it("dedupes a photo placed in two authorized families; families lists both", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const photo = await photoIn([famA.id, famB.id], rosa.id, "k/dup");

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [famA.id, famB.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(photo.id);
    // families sorted by name → Carney, Esposito.
    expect(rows[0]!.families.map((f) => f.familyName)).toEqual(["Carney", "Esposito"]);
  });

  it("only lists AUTHORIZED placements; a family the viewer isn't in is dropped from the row", async () => {
    // Rosa contributes a photo into famA (she's in) AND famB (a family she is NOT a member of).
    const rosa = await makePerson(db, "Rosa");
    const other = await makePerson(db, "Other");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamily(db, "Carney", other.id); // rosa NOT a member
    await addMembership(db, other.id, famB.id, "active");
    const photo = await photoIn([famA.id, famB.id], rosa.id, "k/mixed");

    // Rosa asks for both; famB is silently dropped, and the row's families shows only famA.
    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [famA.id, famB.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(photo.id);
    expect(rows[0]!.families).toEqual([
      { familyId: famA.id, familyName: "Esposito", familyShortName: null },
    ]);
  });

  it("surfaces a family's steward-set short name on each placement (ADR-0021)", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("The Esposito Family", rosa.id);
    await db.update(families).set({ shortName: "Espositos" }).where(eq(families.id, fam.id));
    await photoIn([fam.id], rosa.id, "k/short");

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [fam.id]);
    expect(rows[0]!.families).toEqual([
      { familyId: fam.id, familyName: "The Esposito Family", familyShortName: "Espositos" },
    ]);
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

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [fam.id]);
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
  });

  it("orders most-recent first (createdAt desc)", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const first = await photoIn([fam.id], rosa.id, "k/1");
    // Force a strictly later createdAt on the second photo so ordering is deterministic.
    const second = await photoIn([fam.id], rosa.id, "k/2");
    await db
      .update(familyPhotos)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(familyPhotos.id, second.id));

    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [fam.id]);
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  // #217: defensive cap. The detailed read returns at most `opts.limit` DISTINCT photos, keeping the
  // most-recent — even for a photo placed in several authorized families (deduped before the cap).
  it("caps at opts.limit, keeping the most-recent distinct photos", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      // Each photo is placed in BOTH families → two placement rows apiece; the cap must count the
      // DISTINCT photo, not the placement rows.
      const p = await photoIn([famA.id, famB.id], rosa.id, `k/cap-${i}`);
      await db
        .update(familyPhotos)
        .set({ createdAt: new Date(base + i * 60_000) })
        .where(eq(familyPhotos.id, p.id));
      ids.push(p.id);
    }
    const rows = await listAlbumPhotosDetailed(db, account(rosa.id), [famA.id, famB.id], { limit: 2 });
    expect(rows.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    // The kept rows still carry BOTH authorized placements (cap doesn't corrupt the join).
    expect(rows[0]!.families.map((f) => f.familyName)).toEqual(["Carney", "Esposito"]);
  });
});
