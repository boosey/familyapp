/**
 * Photo tagging (album enhancements, 2026-07-13) — subjects, people, places, retarget, and the
 * detail read. Mirrors the story-subject test style. The authorization model under test:
 *   - tag / untag / list = SEE-gated (must READ the photo AND be an identified account). Any
 *     co-viewer may tag; tagging NEVER widens who can see the photo. A non-viewer is DENIED to tag
 *     and gets an EMPTY list (no leak).
 *   - retargetPhotoFamilies = MANAGE-gated (contributor or steward).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotoFamilies } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAlbumPhoto,
  getAlbumPhotoDetail,
  listPhotoPeople,
  listPhotoPlaces,
  listPhotoSubjects,
  listPlacesForFamily,
  retargetPhotoFamilies,
  tagPhotoPerson,
  tagPhotoPlace,
  tagPhotoSubject,
  untagPhotoPerson,
  untagPhotoPlace,
  untagPhotoSubject,
  type AuthContext,
} from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });
const anon: AuthContext = { kind: "anonymous" };

/** A family with `contributor` as its active member/steward. */
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

describe.each([
  { label: "subjects", tag: tagPhotoSubject, untag: untagPhotoSubject, list: listPhotoSubjects },
  { label: "people", tag: tagPhotoPerson, untag: untagPhotoPerson, list: listPhotoPeople },
])("photo $label tagging", ({ tag, untag, list }) => {
  it("a co-member can tag an existing person; the tag is listed", async () => {
    const rosa = await makePerson(db, "Rosa");
    const sal = await makePerson(db, "Salvatore");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await addMembership(db, sal.id, fam.id, "active");
    const photo = await photoIn([fam.id], rosa.id, "k/a");

    const res = await tag(db, account(sal.id), { photoId: photo.id, personId: rosa.id });
    expect(res.allowed).toBe(true);
    expect(res.tagged).toBe(true);
    expect(res.personId).toBe(rosa.id);
    expect(res.createdPersonId).toBeUndefined();

    const tags = await list(db, account(sal.id), photo.id);
    expect(tags.map((t) => t.personId)).toEqual([rosa.id]);
    expect(tags[0]!.taggedByPersonId).toBe(sal.id);
    expect(tags[0]!.displayName).toBe("Rosa");
  });

  it("mints a new mention person when tagging by name", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/b");

    const res = await tag(db, account(rosa.id), {
      photoId: photo.id,
      newPersonDisplayName: "Great Aunt Lucia",
    });
    expect(res.allowed).toBe(true);
    expect(res.personId).toBeDefined();
    expect(res.createdPersonId).toBe(res.personId);

    const tags = await list(db, account(rosa.id), photo.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.displayName).toBe("Great Aunt Lucia");
  });

  it("is idempotent per (photo, person)", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/c");

    await tag(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    await tag(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    const tags = await list(db, account(rosa.id), photo.id);
    expect(tags).toHaveLength(1);
  });

  it("untag is idempotent (no-op when not tagged) and removes an existing tag", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/d");

    // untag before any tag exists — allowed no-op.
    const d0 = await untag(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    expect(d0.allowed).toBe(true);

    await tag(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    await untag(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    expect(await list(db, account(rosa.id), photo.id)).toHaveLength(0);
  });

  it("a non-viewer is DENIED to tag and gets an EMPTY list; no person minted", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/e");

    const res = await tag(db, account(outsider.id), {
      photoId: photo.id,
      newPersonDisplayName: "Should Not Exist",
    });
    expect(res.allowed).toBe(false);
    expect(res.tagged).toBeUndefined();
    // Outsider cannot see the photo → empty list even though they attempted a tag.
    expect(await list(db, account(outsider.id), photo.id)).toEqual([]);
    // The contributor, who CAN see, also sees no tag (the denied attempt wrote nothing / minted nothing).
    expect(await list(db, account(rosa.id), photo.id)).toEqual([]);
  });

  it("anonymous actor is DENIED to tag", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/f");
    const res = await tag(db, anon, { photoId: photo.id, personId: rosa.id });
    expect(res.allowed).toBe(false);
  });

  it("tagging does NOT change who can see the photo", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/g");
    // Tag the outsider as subject/person — this must not grant them visibility.
    await tag(db, account(rosa.id), { photoId: photo.id, personId: outsider.id });
    expect(await getAlbumPhotoDetail(db, account(outsider.id), photo.id)).toBeNull();
    expect(await list(db, account(outsider.id), photo.id)).toEqual([]);
  });
});

describe("subjects and people are separate dimensions", () => {
  it("a subject tag does not appear in people, and vice versa", async () => {
    const rosa = await makePerson(db, "Rosa");
    const sal = await makePerson(db, "Salvatore");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/sep");

    await tagPhotoSubject(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    await tagPhotoPerson(db, account(rosa.id), { photoId: photo.id, personId: sal.id });

    expect((await listPhotoSubjects(db, account(rosa.id), photo.id)).map((t) => t.personId)).toEqual([
      rosa.id,
    ]);
    expect((await listPhotoPeople(db, account(rosa.id), photo.id)).map((t) => t.personId)).toEqual([
      sal.id,
    ]);
  });
});

describe("photo places", () => {
  it("tags by new name, creating then reusing (case-insensitive) within a family", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const p1 = await photoIn([fam.id], rosa.id, "k/p1");
    const p2 = await photoIn([fam.id], rosa.id, "k/p2");

    const r1 = await tagPhotoPlace(db, account(rosa.id), { photoId: p1.id, newPlaceName: "Naples" });
    expect(r1.allowed).toBe(true);
    expect(r1.createdPlaceId).toBe(r1.placeId);

    // Different casing / whitespace reuses the same place row (dedup by name within the family).
    const r2 = await tagPhotoPlace(db, account(rosa.id), { photoId: p2.id, newPlaceName: "  naples " });
    expect(r2.allowed).toBe(true);
    expect(r2.createdPlaceId).toBeUndefined();
    expect(r2.placeId).toBe(r1.placeId);

    expect(await listPlacesForFamily(db, account(rosa.id), fam.id)).toEqual([
      { placeId: r1.placeId, name: "Naples" },
    ]);
  });

  it("tags by existing placeId when the place's family matches a placement", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const p1 = await photoIn([fam.id], rosa.id, "k/p3");
    const p2 = await photoIn([fam.id], rosa.id, "k/p4");
    const created = await tagPhotoPlace(db, account(rosa.id), { photoId: p1.id, newPlaceName: "Cherry St" });

    const linked = await tagPhotoPlace(db, account(rosa.id), { photoId: p2.id, placeId: created.placeId! });
    expect(linked.allowed).toBe(true);
    expect(linked.placeId).toBe(created.placeId);
    const tags = await listPhotoPlaces(db, account(rosa.id), p2.id);
    expect(tags.map((t) => t.placeId)).toEqual([created.placeId]);
    expect(tags[0]!.name).toBe("Cherry St");
    expect(tags[0]!.familyId).toBe(fam.id);
  });

  it("rejects an ambiguous new place when the photo is in multiple families and no familyId given", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const photo = await photoIn([famA.id, famB.id], rosa.id, "k/amb");

    await expect(
      tagPhotoPlace(db, account(rosa.id), { photoId: photo.id, newPlaceName: "Somewhere" }),
    ).rejects.toThrow(/ambiguous/i);

    // With an explicit, valid familyId it succeeds.
    const ok = await tagPhotoPlace(db, account(rosa.id), {
      photoId: photo.id,
      newPlaceName: "Somewhere",
      familyId: famB.id,
    });
    expect(ok.allowed).toBe(true);
    expect(await listPlacesForFamily(db, account(rosa.id), famB.id)).toHaveLength(1);
    expect(await listPlacesForFamily(db, account(rosa.id), famA.id)).toHaveLength(0);
  });

  it("untag place is idempotent", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/pu");
    const created = await tagPhotoPlace(db, account(rosa.id), { photoId: photo.id, newPlaceName: "Naples" });

    const d0 = await untagPhotoPlace(db, account(rosa.id), { photoId: photo.id, placeId: created.placeId! });
    expect(d0.allowed).toBe(true);
    expect(await listPhotoPlaces(db, account(rosa.id), photo.id)).toHaveLength(0);
    // second untag = no-op still allowed.
    expect((await untagPhotoPlace(db, account(rosa.id), { photoId: photo.id, placeId: created.placeId! })).allowed).toBe(true);
  });

  it("a non-viewer is denied to place-tag and listPlacesForFamily is membership-gated", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/pd");

    const res = await tagPhotoPlace(db, account(outsider.id), { photoId: photo.id, newPlaceName: "X" });
    expect(res.allowed).toBe(false);
    // Non-member sees no places for the family.
    await tagPhotoPlace(db, account(rosa.id), { photoId: photo.id, newPlaceName: "Naples" });
    expect(await listPlacesForFamily(db, account(outsider.id), fam.id)).toEqual([]);
    expect(await listPlacesForFamily(db, anon, fam.id)).toEqual([]);
  });
});

describe("retargetPhotoFamilies (MANAGE-gated)", () => {
  it("the contributor can replace the photo's placement set", async () => {
    const rosa = await makePerson(db, "Rosa");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const photo = await photoIn([famA.id], rosa.id, "k/rt1");

    const d = await retargetPhotoFamilies(db, account(rosa.id), {
      photoId: photo.id,
      familyIds: [famB.id],
    });
    expect(d.allowed).toBe(true);
    const rows = await db
      .select({ familyId: familyPhotoFamilies.familyId })
      .from(familyPhotoFamilies)
      .where(eq(familyPhotoFamilies.photoId, photo.id));
    expect(rows.map((r) => r.familyId)).toEqual([famB.id]);
  });

  it("a steward (non-contributor) can retarget", async () => {
    const rosa = await makePerson(db, "Rosa"); // contributor
    const steward = await makePerson(db, "Steward");
    // Family whose steward is `steward`; rosa + steward are members.
    const fam = await makeFamily(db, "Esposito", steward.id);
    await addMembership(db, steward.id, fam.id, "active");
    await addMembership(db, rosa.id, fam.id, "active");
    const famB = await makeFamily(db, "Carney", steward.id);
    await addMembership(db, steward.id, famB.id, "active");
    const photo = await photoIn([fam.id], rosa.id, "k/rt2");

    const d = await retargetPhotoFamilies(db, account(steward.id), {
      photoId: photo.id,
      familyIds: [famB.id],
    });
    expect(d.allowed).toBe(true);
  });

  it("a plain member (non-contributor, non-steward) is denied", async () => {
    const rosa = await makePerson(db, "Rosa"); // contributor + steward of fam
    const member = await makePerson(db, "Member");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await addMembership(db, member.id, fam.id, "active");
    const photo = await photoIn([fam.id], rosa.id, "k/rt3");

    const d = await retargetPhotoFamilies(db, account(member.id), {
      photoId: photo.id,
      familyIds: [fam.id],
    });
    expect(d.allowed).toBe(false);
    // Placement unchanged.
    const rows = await db
      .select({ familyId: familyPhotoFamilies.familyId })
      .from(familyPhotoFamilies)
      .where(eq(familyPhotoFamilies.photoId, photo.id));
    expect(rows.map((r) => r.familyId)).toEqual([fam.id]);
  });

  it("cannot place into a family the actor is not an active member of", async () => {
    const rosa = await makePerson(db, "Rosa");
    const other = await makePerson(db, "Other");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamily(db, "Carney", other.id); // rosa is NOT a member
    const photo = await photoIn([famA.id], rosa.id, "k/rt4");

    await expect(
      retargetPhotoFamilies(db, account(rosa.id), { photoId: photo.id, familyIds: [famB.id] }),
    ).rejects.toThrow(/not an active member/i);
  });

  it("requires at least one family", async () => {
    const rosa = await makePerson(db, "Rosa");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/rt5");
    await expect(
      retargetPhotoFamilies(db, account(rosa.id), { photoId: photo.id, familyIds: [] }),
    ).rejects.toThrow(/at least one family/i);
  });
});

describe("getAlbumPhotoDetail", () => {
  it("returns families, tag groups, and canManage=true for a manager", async () => {
    const rosa = await makePerson(db, "Rosa");
    const sal = await makePerson(db, "Salvatore");
    const famA = await makeFamilyWithMember("Esposito", rosa.id);
    const famB = await makeFamilyWithMember("Carney", rosa.id);
    const photo = await photoIn([famA.id, famB.id], rosa.id, "k/det");

    await tagPhotoSubject(db, account(rosa.id), { photoId: photo.id, personId: rosa.id });
    await tagPhotoPerson(db, account(rosa.id), { photoId: photo.id, personId: sal.id });
    await tagPhotoPlace(db, account(rosa.id), { photoId: photo.id, newPlaceName: "Naples", familyId: famA.id });

    const detail = await getAlbumPhotoDetail(db, account(rosa.id), photo.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(photo.id);
    expect(detail!.contributorDisplayName).toBe("Rosa");
    expect(detail!.families.map((f) => f.familyName).sort()).toEqual(["Carney", "Esposito"]);
    expect(detail!.subjects.map((s) => s.personId)).toEqual([rosa.id]);
    expect(detail!.people.map((s) => s.personId)).toEqual([sal.id]);
    expect(detail!.places.map((p) => p.name)).toEqual(["Naples"]);
    expect(detail!.canManage).toBe(true);
  });

  it("returns null for a non-viewer", async () => {
    const rosa = await makePerson(db, "Rosa");
    const outsider = await makePerson(db, "Outsider");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    const photo = await photoIn([fam.id], rosa.id, "k/det2");
    expect(await getAlbumPhotoDetail(db, account(outsider.id), photo.id)).toBeNull();
    expect(await getAlbumPhotoDetail(db, anon, photo.id)).toBeNull();
  });

  it("canManage=false for a plain co-member who can see but not manage", async () => {
    const rosa = await makePerson(db, "Rosa"); // contributor + steward
    const member = await makePerson(db, "Member");
    const fam = await makeFamilyWithMember("Esposito", rosa.id);
    await addMembership(db, member.id, fam.id, "active");
    const photo = await photoIn([fam.id], rosa.id, "k/det3");
    const detail = await getAlbumPhotoDetail(db, account(member.id), photo.id);
    expect(detail).not.toBeNull();
    expect(detail!.canManage).toBe(false);
  });
});
