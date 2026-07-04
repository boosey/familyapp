/**
 * Server-side integration tests for the story ACCOMPANIMENT editor actions (ADR-0009 Phase 2,
 * `answer/[askId]/photo-actions.ts`). These are the security boundary for the guarded `story_images`
 * table on the web: each action re-resolves auth SERVER-side and verifies the actor OWNS the draft
 * story before calling a core write primitive. We drive the REAL core seams against a PGlite DB and
 * observe the effects via `listStoryImages` — proving the right seam is called, not just mocked.
 *
 * Harness mirrors album.server.test.ts / compose-story-action.server.test.ts: `@/lib/runtime` is
 * mocked so importing the module doesn't boot the real DEV runtime; getRuntime() reads settable
 * module-level bindings. `next/cache`'s revalidatePath is a no-op (no Next request scope).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: AuthContext;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  createAlbumPhoto,
  listStoryImages,
  type AuthContext,
} from "@chronicle/core";
import { ingestTextStory } from "@chronicle/capture";
import {
  loadStoryPhotoEditorAction,
  attachStoryPhotoAction,
  detachStoryPhotoAction,
  setStoryCoverAction,
  reorderStoryPhotosAction,
} from "@/app/hub/answer/[askId]/photo-actions";
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

async function makePhoto(contributorId: string, familyId: string, caption: string | null): Promise<string> {
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: `family-photos/${crypto.randomUUID()}`,
    caption,
  });
  return photo.id;
}

async function makeDraftStory(ownerId: string): Promise<string> {
  const { storyId } = await ingestTextStory(runtimeDb, {
    actor: { kind: "account", personId: ownerId },
    text: "A memory the narrator typed for the accompaniment tests.",
  });
  return storyId;
}

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.append(k, v);
  }
  return fd;
}

// A minimal owner + family + draft-story + album fixture.
async function fixture() {
  const owner = await makePerson("Rosa");
  const familyId = await makeFamily("Esposito", owner);
  await addMember(owner, familyId);
  const storyId = await makeDraftStory(owner);
  const photoA = await makePhoto(owner, familyId, "First photo");
  const photoB = await makePhoto(owner, familyId, "Second photo");
  return { owner, familyId, storyId, photoA, photoB };
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("loadStoryPhotoEditorAction", () => {
  it("returns the owner's un-attached album photos and no attached images initially", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) throw new Error(`expected ok, got ${res.error}`);
    expect(res.attached).toHaveLength(0);
    expect(res.album.map((p) => p.photoId).sort()).toEqual([photoA, photoB].sort());
  });

  it("excludes already-attached photos from the album picker", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);

    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) throw new Error(`expected ok, got ${res.error}`);
    expect(res.attached.map((a) => a.familyPhotoId)).toEqual([photoA]);
    expect(res.album.map((p) => p.photoId)).toEqual([photoB]);
  });

  it("rejects a non-owner (storyNotFound — the front door hides a foreign draft)", async () => {
    const { storyId } = await fixture();
    const stranger = await makePerson("Mallory");
    authCtx = account(stranger);

    const res = await loadStoryPhotoEditorAction(storyId);
    expect(res).toEqual({ error: hub.actions.storyNotFound });
  });

  it("rejects an unauthenticated caller (auth is re-resolved server-side)", async () => {
    const { storyId } = await fixture();
    authCtx = { kind: "anonymous" };
    const res = await loadStoryPhotoEditorAction(storyId);
    expect(res).toEqual({ error: hub.actions.notSignedIn });
  });
});

describe("attachStoryPhotoAction", () => {
  it("attaches a photo and makes the FIRST image the cover", async () => {
    const { owner, storyId, photoA } = await fixture();
    authCtx = account(owner);

    const res = await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    expect(res).toEqual({ ok: true });

    const images = await listStoryImages(runtimeDb, storyId);
    expect(images).toHaveLength(1);
    expect(images[0]!.familyPhotoId).toBe(photoA);
    expect(images[0]!.isCover).toBe(true);
  });

  it("maps a duplicate attach to a friendly error (no unhandled throw)", async () => {
    const { owner, storyId, photoA } = await fixture();
    authCtx = account(owner);

    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    const dup = await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    expect(dup).toEqual({ error: hub.actions.photoAttachFailed });
    expect(await listStoryImages(runtimeDb, storyId)).toHaveLength(1);
  });

  it("rejects a non-owner and writes nothing", async () => {
    const { storyId, photoA } = await fixture();
    const stranger = await makePerson("Mallory");
    authCtx = account(stranger);

    const res = await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    expect(res).toEqual({ error: hub.actions.storyNotFound });
    expect(await listStoryImages(runtimeDb, storyId)).toHaveLength(0);
  });

  // IDOR regression: the OWNER of the draft (so `requireDraftOwner` passes) tries to attach a photo
  // from a family they are NOT in, by id. The core primitive's actor-vs-photo authorization
  // (contributor OR active-family-member) throws InvariantViolation → our catch-all maps it to
  // photoAttachFailed, and nothing is written. This is the path the picker never offers.
  it("rejects the owner attaching a photo from a family they are not in (cross-family IDOR)", async () => {
    const { owner, storyId } = await fixture(); // owner A, in family FamA
    // Person B in a SEPARATE family contributes a photo to B's OWN album. A is not a member of B's
    // family, and A is not the photo's contributor.
    const personB = await makePerson("Bruno");
    const familyB = await makeFamily("Bianchi", personB);
    await addMember(personB, familyB);
    const photoB = await makePhoto(personB, familyB, "Bruno's photo");

    authCtx = account(owner);
    const res = await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoB }));

    expect(res).toEqual({ error: hub.actions.photoAttachFailed });
    expect(await listStoryImages(runtimeDb, storyId)).toHaveLength(0);
  });
});

describe("setStoryCoverAction", () => {
  it("moves the cover to the chosen image (exactly one cover)", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);

    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA })); // A is cover
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoB }));

    const before = await listStoryImages(runtimeDb, storyId);
    const bImage = before.find((i) => i.familyPhotoId === photoB)!;

    const res = await setStoryCoverAction(form({ storyId, storyImageId: bImage.id }));
    expect(res).toEqual({ ok: true });

    const after = await listStoryImages(runtimeDb, storyId);
    expect(after.filter((i) => i.isCover).map((i) => i.familyPhotoId)).toEqual([photoB]);
  });

  it("rejects a non-owner", async () => {
    const { owner, storyId, photoA } = await fixture();
    authCtx = account(owner);
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    const [img] = await listStoryImages(runtimeDb, storyId);

    const stranger = await makePerson("Mallory");
    authCtx = account(stranger);
    const res = await setStoryCoverAction(form({ storyId, storyImageId: img!.id }));
    expect(res).toEqual({ error: hub.actions.storyNotFound });
  });
});

describe("detachStoryPhotoAction", () => {
  it("removes an image and promotes the survivor to cover", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);

    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA })); // A cover
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoB }));
    const imgs = await listStoryImages(runtimeDb, storyId);
    const aImg = imgs.find((i) => i.familyPhotoId === photoA)!;

    const res = await detachStoryPhotoAction(form({ storyId, storyImageId: aImg.id }));
    expect(res).toEqual({ ok: true });

    const after = await listStoryImages(runtimeDb, storyId);
    expect(after.map((i) => i.familyPhotoId)).toEqual([photoB]);
    expect(after[0]!.isCover).toBe(true); // survivor promoted
  });

  it("rejects a non-owner and keeps the image", async () => {
    const { owner, storyId, photoA } = await fixture();
    authCtx = account(owner);
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    const [img] = await listStoryImages(runtimeDb, storyId);

    const stranger = await makePerson("Mallory");
    authCtx = account(stranger);
    const res = await detachStoryPhotoAction(form({ storyId, storyImageId: img!.id }));
    expect(res).toEqual({ error: hub.actions.storyNotFound });
    expect(await listStoryImages(runtimeDb, storyId)).toHaveLength(1);
  });
});

describe("reorderStoryPhotosAction", () => {
  it("rewrites positions to the given order", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);

    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA })); // position 0
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoB })); // position 1
    const imgs = await listStoryImages(runtimeDb, storyId);
    const [a, b] = imgs;

    const res = await reorderStoryPhotosAction(
      form({ storyId, orderedStoryImageIds: [b!.id, a!.id] }),
    );
    expect(res).toEqual({ ok: true });

    const after = await listStoryImages(runtimeDb, storyId);
    expect(after.map((i) => i.familyPhotoId)).toEqual([photoB, photoA]);
  });

  it("rejects a non-owner", async () => {
    const { owner, storyId, photoA, photoB } = await fixture();
    authCtx = account(owner);
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoA }));
    await attachStoryPhotoAction(form({ storyId, familyPhotoId: photoB }));
    const imgs = await listStoryImages(runtimeDb, storyId);

    const stranger = await makePerson("Mallory");
    authCtx = account(stranger);
    const res = await reorderStoryPhotosAction(
      form({ storyId, orderedStoryImageIds: imgs.map((i) => i.id) }),
    );
    expect(res).toEqual({ error: hub.actions.storyNotFound });
  });
});
