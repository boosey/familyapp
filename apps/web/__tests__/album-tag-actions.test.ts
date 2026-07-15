/**
 * Server-side integration tests for the Phase-B2 album photo TAG actions (mirrors
 * album.server.test.ts's harness): `@/lib/runtime` is mocked so importing the module doesn't boot the
 * real DEV runtime; getRuntime() reads settable module-level bindings. `next/cache`'s revalidatePath
 * is a no-op (no Next request scope). The REAL core runs against a fresh PGlite db per test.
 *
 * Coverage: a contributor tags a subject/person/place (happy path returns the id); a non-member is
 * rejected with `{ error }` and nothing is written; untag is idempotent; retarget rejects a plain
 * member; loadPhotoTagPanelAction returns detail + suggestions for a viewer and `{ error }` for a
 * non-viewer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: AuthContext;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: undefined,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  createAlbumPhoto,
  listPhotoSubjects,
  listPhotoPeople,
  listPhotoPlaces,
  getAlbumPhotoForViewer,
  type AuthContext,
} from "@chronicle/core";
import {
  tagPhotoSubjectAction,
  untagPhotoSubjectAction,
  tagPhotoPersonAction,
  untagPhotoPersonAction,
  tagPhotoPlaceAction,
  untagPhotoPlaceAction,
  retargetPhotoFamiliesAction,
  loadPhotoTagPanelAction,
} from "@/app/hub/album/actions";
import { hub } from "@/app/_copy";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function makePerson(name: string): Promise<string> {
  const [p] = await runtimeDb
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

async function makeFamily(name: string, creatorId: string): Promise<string> {
  const [f] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!.id;
}

async function addMember(personId: string, familyId: string): Promise<void> {
  await runtimeDb.insert(memberships).values({ personId, familyId, status: "active" });
}

/** steward = family creator; contributor + plainMember are separate active members; stranger is not. */
async function seed(): Promise<{
  steward: string;
  contributor: string;
  plainMember: string;
  stranger: string;
  familyId: string;
  photoId: string;
}> {
  const steward = await makePerson("Nonna");
  const contributor = await makePerson("Rosa");
  const plainMember = await makePerson("Sal");
  const stranger = await makePerson("Stranger");
  const familyId = await makeFamily("Esposito", steward);
  await addMember(steward, familyId);
  await addMember(contributor, familyId);
  await addMember(plainMember, familyId);
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributor,
    familyIds: [familyId],
    source: "upload",
    storageKey: "family-photos/tag-test",
    caption: null,
  });
  return { steward, contributor, plainMember, stranger, familyId, photoId: photo.id };
}

function personForm(photoId: string, personId: string): FormData {
  const fd = new FormData();
  fd.append("photoId", photoId);
  fd.append("personId", personId);
  return fd;
}
function newPersonForm(photoId: string, displayName: string): FormData {
  const fd = new FormData();
  fd.append("photoId", photoId);
  fd.append("newPersonDisplayName", displayName);
  return fd;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("tag/untag person-group actions (subjects + appears-in)", () => {
  it("a member tags an EXISTING person as a subject (returns the id, row written)", async () => {
    const { contributor, plainMember, photoId } = await seed();
    authCtx = account(contributor);
    const result = await tagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(result).toEqual({ personId: plainMember });
    const subjects = await listPhotoSubjects(runtimeDb, account(contributor), photoId);
    expect(subjects.map((s) => s.personId)).toEqual([plainMember]);
  });

  it("a member tags a NEW person inline as a subject (mints + forwards the id)", async () => {
    const { contributor, photoId } = await seed();
    authCtx = account(contributor);
    const result = await tagPhotoSubjectAction(newPersonForm(photoId, "Aunt Lucia"));
    expect("personId" in result).toBe(true);
    const mintedId = (result as { personId: string }).personId;
    const subjects = await listPhotoSubjects(runtimeDb, account(contributor), photoId);
    expect(subjects.map((s) => s.personId)).toEqual([mintedId]);
    expect(subjects[0]!.displayName).toBe("Aunt Lucia");
  });

  it("tags an appears-in person on the SEPARATE people group", async () => {
    const { contributor, plainMember, photoId } = await seed();
    authCtx = account(contributor);
    const result = await tagPhotoPersonAction(personForm(photoId, plainMember));
    expect(result).toEqual({ personId: plainMember });
    // Written to people, NOT subjects (two distinct tables).
    const people = await listPhotoPeople(runtimeDb, account(contributor), photoId);
    expect(people.map((p) => p.personId)).toEqual([plainMember]);
    const subjects = await listPhotoSubjects(runtimeDb, account(contributor), photoId);
    expect(subjects).toEqual([]);
  });

  it("rejects a NON-member with { error } and writes nothing", async () => {
    const { contributor, plainMember, stranger, photoId } = await seed();
    authCtx = account(stranger);
    const result = await tagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(result).toEqual({ error: hub.album.tagSaveError });
    // Nothing landed (read as a real member).
    const subjects = await listPhotoSubjects(runtimeDb, account(contributor), photoId);
    expect(subjects).toEqual([]);
  });

  it("rejects an anonymous caller with the not-signed-in error", async () => {
    const { photoId, plainMember } = await seed();
    authCtx = { kind: "anonymous" };
    const result = await tagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(result).toEqual({ error: hub.actions.notSignedIn });
  });

  it("rejects invalid input (both personId and newPersonDisplayName)", async () => {
    const { contributor, plainMember, photoId } = await seed();
    authCtx = account(contributor);
    const fd = personForm(photoId, plainMember);
    fd.append("newPersonDisplayName", "Also This");
    const result = await tagPhotoSubjectAction(fd);
    expect(result).toEqual({ error: hub.actions.invalidInput });
  });

  it("untag is idempotent (untagging a not-tagged person still succeeds)", async () => {
    const { contributor, plainMember, photoId } = await seed();
    authCtx = account(contributor);
    // Untag before any tag → still ok (idempotent).
    const first = await untagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(first).toEqual({ ok: true });
    // Tag then untag twice.
    await tagPhotoSubjectAction(personForm(photoId, plainMember));
    const second = await untagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(second).toEqual({ ok: true });
    const third = await untagPhotoSubjectAction(personForm(photoId, plainMember));
    expect(third).toEqual({ ok: true });
    const subjects = await listPhotoSubjects(runtimeDb, account(contributor), photoId);
    expect(subjects).toEqual([]);
  });

  it("untagPhotoPersonAction removes from the appears-in group", async () => {
    const { contributor, plainMember, photoId } = await seed();
    authCtx = account(contributor);
    await tagPhotoPersonAction(personForm(photoId, plainMember));
    const result = await untagPhotoPersonAction(personForm(photoId, plainMember));
    expect(result).toEqual({ ok: true });
    const people = await listPhotoPeople(runtimeDb, account(contributor), photoId);
    expect(people).toEqual([]);
  });
});

describe("tag/untag place actions", () => {
  it("a member tags a NEW place (creates + returns the id)", async () => {
    const { contributor, photoId } = await seed();
    authCtx = account(contributor);
    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("newPlaceName", "The Old House");
    const result = await tagPhotoPlaceAction(fd);
    expect("placeId" in result).toBe(true);
    const placeId = (result as { placeId: string }).placeId;
    const places = await listPhotoPlaces(runtimeDb, account(contributor), photoId);
    expect(places.map((p) => p.placeId)).toEqual([placeId]);
    expect(places[0]!.name).toBe("The Old House");
  });

  it("a NON-member is rejected with { error } and no place is written", async () => {
    const { contributor, stranger, photoId } = await seed();
    authCtx = account(stranger);
    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("newPlaceName", "Sneaky Place");
    const result = await tagPhotoPlaceAction(fd);
    expect(result).toEqual({ error: hub.album.tagSaveError });
    const places = await listPhotoPlaces(runtimeDb, account(contributor), photoId);
    expect(places).toEqual([]);
  });

  it("rejects invalid input (neither placeId nor newPlaceName)", async () => {
    const { contributor, photoId } = await seed();
    authCtx = account(contributor);
    const fd = new FormData();
    fd.append("photoId", photoId);
    const result = await tagPhotoPlaceAction(fd);
    expect(result).toEqual({ error: hub.actions.invalidInput });
  });

  it("untag place is idempotent", async () => {
    const { contributor, photoId } = await seed();
    authCtx = account(contributor);
    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("newPlaceName", "The Old House");
    const tagged = (await tagPhotoPlaceAction(fd)) as { placeId: string };

    const un = new FormData();
    un.append("photoId", photoId);
    un.append("placeId", tagged.placeId);
    expect(await untagPhotoPlaceAction(un)).toEqual({ ok: true });
    // Second untag still ok.
    expect(await untagPhotoPlaceAction(un)).toEqual({ ok: true });
    const places = await listPhotoPlaces(runtimeDb, account(contributor), photoId);
    expect(places).toEqual([]);
  });
});

describe("retargetPhotoFamiliesAction (MANAGE-gated)", () => {
  it("lets the contributor re-place the photo into a different owned family", async () => {
    const { contributor, familyId, photoId } = await seed();
    // Give the contributor a second family and move the photo there.
    const famB = await makeFamily("Marino", contributor);
    await addMember(contributor, famB);
    authCtx = account(contributor);

    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("familyIds", famB);
    const result = await retargetPhotoFamiliesAction(fd);
    expect(result).toEqual({ ok: true });

    const detail = await getAlbumPhotoForViewer(runtimeDb, account(contributor), photoId);
    // Still visible to the contributor (member of famB); the original family is gone.
    expect(detail).not.toBeNull();
    void familyId;
  });

  it("rejects a PLAIN member (not contributor, not steward) and leaves placement unchanged", async () => {
    const { contributor, plainMember, familyId, photoId } = await seed();
    authCtx = account(plainMember);
    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("familyIds", familyId); // even a valid family they belong to — they can't MANAGE.
    const result = await retargetPhotoFamiliesAction(fd);
    expect(result).toEqual({ error: hub.actions.notAllowedToManagePhoto });
    // Placement intact: the original family's member still sees it.
    const detail = await getAlbumPhotoForViewer(runtimeDb, account(contributor), photoId);
    expect(detail).not.toBeNull();
  });

  it("rejects an anonymous caller", async () => {
    const { familyId, photoId } = await seed();
    authCtx = { kind: "anonymous" };
    const fd = new FormData();
    fd.append("photoId", photoId);
    fd.append("familyIds", familyId);
    const result = await retargetPhotoFamiliesAction(fd);
    expect(result).toEqual({ error: hub.actions.notSignedIn });
  });
});

describe("loadPhotoTagPanelAction", () => {
  it("returns detail + suggestions for a viewer who can see the photo", async () => {
    const { steward, contributor, plainMember, familyId, photoId } = await seed();
    // Tag a subject and a place so the detail carries real tag groups.
    authCtx = account(contributor);
    await tagPhotoSubjectAction(personForm(photoId, plainMember));
    const placeFd = new FormData();
    placeFd.append("photoId", photoId);
    placeFd.append("newPlaceName", "The Old House");
    await tagPhotoPlaceAction(placeFd);

    const panel = await loadPhotoTagPanelAction(photoId);
    expect("detail" in panel).toBe(true);
    if (!("detail" in panel)) throw new Error("unreachable");

    // Detail reflects the seeded photo + its tags.
    expect(panel.detail.id).toBe(photoId);
    expect(panel.detail.canManage).toBe(true); // the contributor can manage
    expect(panel.detail.subjects.map((s) => s.personId)).toEqual([plainMember]);
    expect(panel.detail.places.map((p) => p.name)).toEqual(["The Old House"]);
    expect(panel.detail.families.map((f) => f.familyId)).toEqual([familyId]);

    // Families suggestion = the viewer's active families.
    expect(panel.suggestions.families).toEqual([
      { id: familyId, name: "Esposito", shortName: null },
    ]);
    // Places suggestion = the union across placement families (the one we just created).
    expect(panel.suggestions.places.map((p) => p.name)).toEqual(["The Old House"]);
    // People suggestion is present (shape check — kin union, deduped).
    expect(Array.isArray(panel.suggestions.people)).toBe(true);
    void steward;
  });

  it("returns { error } for a non-viewer (stranger)", async () => {
    const { stranger, photoId } = await seed();
    authCtx = account(stranger);
    const panel = await loadPhotoTagPanelAction(photoId);
    expect(panel).toEqual({ error: hub.album.tagPanelLoadError });
  });

  it("returns the not-signed-in error for an anonymous caller", async () => {
    const { photoId } = await seed();
    authCtx = { kind: "anonymous" };
    const panel = await loadPhotoTagPanelAction(photoId);
    expect(panel).toEqual({ error: hub.actions.notSignedIn });
  });
});
