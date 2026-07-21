/**
 * Server-side integration tests for ADR-0009 Phase 4 · Slice B §5 — the photo-suggestion path
 * through `loadStoryPhotoEditorAction`. Proves the web action wires story signals + album
 * candidates into `rankPhotosForStory` / `pickPhotoNudge` end-to-end (not just unit-tested in
 * `@chronicle/pipeline`).
 *
 * Harness mirrors `story-photo-actions.server.test.ts`: `@/lib/runtime` is mocked so importing
 * the module doesn't boot the real DEV runtime; getRuntime() reads settable module-level
 * bindings. `next/cache`'s revalidatePath is a no-op (no Next request scope).
 *
 * Prose for ranking: `ingestTextStory` creates a bare draft (words not stored); the typed take
 * is written via `appendTypedTakeContribution`, matching the compose path.
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
  appendTypedTakeContribution,
  createAlbumPhoto,
  updateDerivedFields,
  type AuthContext,
} from "@chronicle/core";
import { ingestTextStory } from "@chronicle/capture";
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

async function makePhoto(
  contributorId: string,
  familyId: string,
  caption: string | null,
  exifCapturedAt?: Date | null,
): Promise<string> {
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: `family-photos/${crypto.randomUUID()}`,
    caption,
    ...(exifCapturedAt !== undefined ? { exifCapturedAt } : {}),
  });
  return photo.id;
}

/**
 * Draft whose prose is the ranking signal corpus. `ingestTextStory` alone leaves prose null;
 * append the typed take the same way compose does.
 */
async function makeDraftWithProse(ownerId: string, text: string): Promise<string> {
  const { storyId } = await ingestTextStory(runtimeDb, {
    actor: { kind: "account", personId: ownerId },
    text,
  });
  await appendTypedTakeContribution(runtimeDb, {
    storyId,
    ownerPersonId: ownerId,
    text,
    priorProse: null,
  });
  return storyId;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("loadStoryPhotoEditorAction — Phase 4 suggestion (Slice B §5)", () => {
  it("ranks a caption-matching photo first and sets the nudge", async () => {
    const owner = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", owner);
    await addMember(owner, familyId);

    // Matching photo created FIRST (older). Unrelated created SECOND (newer) so listAlbumPhotos
    // recency alone would put unrelated first and matching second — ranking must lift the match.
    const matching = await makePhoto(owner, familyId, "The porch swing");
    const unrelated = await makePhoto(owner, familyId, "Beach day");

    const storyId = await makeDraftWithProse(
      owner,
      "We sat on the porch every evening that summer.",
    );
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) throw new Error(`expected ok, got ${res.error}`);

    expect(res.album.map((p) => p.photoId)).toEqual([matching, unrelated]);
    expect(res.album[0]!.photoId).toBe(matching);
    expect(res.nudge).toEqual({ photoId: matching, caption: "The porch swing" });
  });

  it("preserves recency order and returns null nudge when nothing matches", async () => {
    const owner = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", owner);
    await addMember(owner, familyId);

    // Older then newer — without any caption/year signal, album stays newest-first.
    const older = await makePhoto(owner, familyId, "Beach day");
    const newer = await makePhoto(owner, familyId, "Kitchen table");

    const storyId = await makeDraftWithProse(
      owner,
      "A quiet afternoon with no shared caption words at all.",
    );
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) throw new Error(`expected ok, got ${res.error}`);

    expect(res.album.map((p) => p.photoId)).toEqual([newer, older]);
    expect(res.nudge).toBeNull();
  });

  it("silently reorders by story-date ∪ EXIF without nudging (year arm only)", async () => {
    const owner = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", owner);
    await addMember(owner, familyId);

    // Near-year photo created FIRST (older row); far-year SECOND (newer). Recency alone would
    // put far first; year proximity must lift near above far. Nudge stays null (no caption).
    const near = await makePhoto(
      owner,
      familyId,
      null,
      new Date(Date.UTC(1982, 0, 1)),
    );
    const far = await makePhoto(
      owner,
      familyId,
      null,
      new Date(Date.UTC(1970, 0, 1)),
    );

    const storyId = await makeDraftWithProse(owner, "A memory with no caption overlap words.");
    await updateDerivedFields(runtimeDb, storyId, {
      occurredKind: "period",
      occurredDate: "1980-01-01",
      occurredEndDate: "1980-12-31",
    });
    authCtx = account(owner);

    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) throw new Error(`expected ok, got ${res.error}`);

    // Near (1982, dist 2) outranks far (1970, dist 10) despite far being newer in the album.
    expect(res.album.map((p) => p.photoId)).toEqual([near, far]);
    expect(res.nudge).toBeNull();
  });
});
