/**
 * Server-side integration tests for ADR-0009 Phase 4 · Slice B — the silent photo-suggestion ranker
 * wired into the draft-story photo editor (`loadStoryPhotoEditorAction`). Proven end-to-end against a
 * REAL PGlite DB, the REAL core read path (`getStoryForViewer` / `listAlbumPhotos`) and the REAL pure
 * ranker (`@chronicle/pipeline`) — no mocks of either. We assert REAL returned data (ranked `album`
 * order + the `nudge` target), never mock call counts.
 *
 * Coverage (contract item 5):
 *   1. A draft whose TEXT matches a photo's CAPTION → that photo is ranked FIRST in `album` (ahead of
 *      a more-recent non-matching photo) AND `nudge` points at it.
 *   2. A draft with NO caption match and null era/exif → `album` stays in recency order (unchanged
 *      from today) AND `nudge` is null (the common, no-signal case).
 *   3. A photo the owner cannot see is never surfaced — the candidate pool is membership-gated, so the
 *      ranker only re-orders an already-authorized list and never widens it.
 *
 * Harness mirrors album.server.test.ts: `@/lib/runtime` is mocked so importing the action module
 * doesn't boot the DEV runtime; getRuntime() reads settable module-level bindings.
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
import { stories } from "@chronicle/db/content";
import { createAlbumPhoto, type AuthContext } from "@chronicle/core";
import { loadStoryPhotoEditorAction } from "@/app/hub/answer/[askId]/photo-actions";

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

/** A text-origin draft story owned by `ownerId`, carrying the given prose (the ranker's text signal). */
async function makeDraft(ownerId: string, prose: string): Promise<string> {
  const [s] = await runtimeDb
    .insert(stories)
    .values({ ownerPersonId: ownerId, kind: "text", state: "draft", prose })
    .returning();
  return s!.id;
}

async function makePhoto(
  contributorId: string,
  familyId: string,
  caption: string | null,
): Promise<string> {
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: `family-photos/${crypto.randomUUID()}`,
    caption,
  });
  return photo.id;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("loadStoryPhotoEditorAction — silent ranking + caption nudge (ADR-0009 Phase 4 · Slice B)", () => {
  it("(1) ranks a caption-matching photo FIRST and points the nudge at it", async () => {
    const owner = await makePerson("Rosa");
    const fam = await makeFamily("Esposito", owner);
    await addMember(owner, fam);

    // The prose mentions "lighthouse". Create the matching photo FIRST, then a non-matching photo —
    // so recency order (most-recent-first) is [birthday, lighthouse]. Ranking must lift lighthouse.
    const lighthouse = await makePhoto(owner, fam, "The old lighthouse at dusk");
    const birthday = await makePhoto(owner, fam, "Birthday cake, 1972");

    const draft = await makeDraft(owner, "We walked out to the lighthouse every summer evening.");
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(draft);
    if ("error" in res) throw new Error(`expected ok, got ${JSON.stringify(res)}`);

    // Silent re-order: the caption match is first despite being the OLDER photo.
    expect(res.album.map((p) => p.photoId)).toEqual([lighthouse, birthday]);
    // Caption-driven nudge points at the matching photo.
    expect(res.nudge).toEqual({ photoId: lighthouse, caption: "The old lighthouse at dusk" });
  });

  it("(2) leaves recency order untouched and nudge null when nothing matches (no signal)", async () => {
    const owner = await makePerson("Rosa");
    const fam = await makeFamily("Esposito", owner);
    await addMember(owner, fam);

    // Neither caption shares a meaningful token with the prose; era/exif are null (no date arm).
    const first = await makePhoto(owner, fam, "Sunset over the bay");
    const second = await makePhoto(owner, fam, "Mountain trail");

    const draft = await makeDraft(owner, "A quiet afternoon spent reading indoors.");
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(draft);
    if ("error" in res) throw new Error(`expected ok, got ${JSON.stringify(res)}`);

    // Recency order preserved exactly (most-recent first) — the picker looks like it did before.
    expect(res.album.map((p) => p.photoId)).toEqual([second, first]);
    expect(res.nudge).toBeNull();
  });

  it("(3) never surfaces a photo the owner cannot see (the pool stays membership-gated)", async () => {
    const owner = await makePerson("Rosa");
    const ownFam = await makeFamily("Esposito", owner);
    await addMember(owner, ownFam);
    const mine = await makePhoto(owner, ownFam, "The old lighthouse");

    // A stranger's photo in a family the owner is NOT in — with a caption that WOULD match the prose.
    const stranger = await makePerson("Mallory");
    const otherFam = await makeFamily("Carney", stranger);
    await addMember(stranger, otherFam);
    const unseeable = await makePhoto(stranger, otherFam, "The old lighthouse at dusk");

    const draft = await makeDraft(owner, "We walked out to the lighthouse every summer evening.");
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(draft);
    if ("error" in res) throw new Error(`expected ok, got ${JSON.stringify(res)}`);

    const ids = res.album.map((p) => p.photoId);
    expect(ids).toEqual([mine]); // only the owner's own photo
    expect(ids).not.toContain(unseeable);
    // The nudge can only ever name an authorized candidate.
    expect(res.nudge?.photoId).not.toBe(unseeable);
  });
});
