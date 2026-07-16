/**
 * Retry-a-failed-pipeline route tests (issue #11), against the REAL @chronicle/core front door.
 *
 *   - a genuinely-failed draft: clears the marker, bumps the attempt, and re-dispatches with it;
 *   - a non-failed draft (still processing / already rendered): 409, no dispatch;
 *   - unknown token → 401; a story the token doesn't own → 404 (no leak); missing param → 400.
 *
 * `@/lib/runtime` is mocked so getRuntime returns our test db + a dispatchPipeline spy (no PGlite/
 * server-only boot, and no real Inngest).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { InMemoryMediaStorage } from "@chronicle/storage";
import {
  getStoryForViewer,
  markStoryProcessingFailed,
  persistRecordingAndCreateDraft,
} from "@chronicle/core";
import { persons } from "@chronicle/db/schema";
import { seedInto } from "../lib/dev-seed";

let runtimeDb: Database;
const dispatchPipeline = vi.fn(async (_storyId: string, _attempt?: number) => {});

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: runtimeDb, dispatchPipeline }),
}));

// Imported AFTER the mock is registered.
import { POST as retryPOST } from "@/app/api/capture/retry/route";

const CHECKSUM = "a".repeat(64);

async function makeDraft(db: Database, ownerPersonId: string): Promise<string> {
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId,
    storageKey: `story-audio/${ownerPersonId}/${crypto.randomUUID()}.webm`,
    contentType: "audio/webm",
    checksum: CHECKSUM,
  });
  return story.id;
}

let eleanor: string;
let token: string;

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  dispatchPipeline.mockClear();
  const seed = await seedInto(runtimeDb, new InMemoryMediaStorage());
  eleanor = seed.narratorPersonId!;
  token = seed.narratorToken!;
});

function retryReq(qs: string): Request {
  return new Request(`http://localhost/api/capture/retry?${qs}`, { method: "POST" });
}

describe("POST /api/capture/retry", () => {
  it("retries a terminally-failed draft: clears the marker, bumps attempt, re-dispatches", async () => {
    const storyId = await makeDraft(runtimeDb, eleanor);
    await markStoryProcessingFailed(runtimeDb, storyId, "render_story: retries exhausted");

    const res = await retryPOST(
      retryReq(`token=${encodeURIComponent(token)}&storyId=${storyId}`),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, storyId, attempt: 1 });

    // Re-dispatched with the fresh attempt token (the dedupe-bust).
    expect(dispatchPipeline).toHaveBeenCalledTimes(1);
    expect(dispatchPipeline).toHaveBeenCalledWith(storyId, 1);

    // The failure marker is cleared, so the status read flips back to processing.
    const read = await getStoryForViewer(
      runtimeDb,
      { kind: "link_session", personId: eleanor },
      storyId,
    );
    expect(read?.processingFailedAt).toBeNull();
    expect(read?.processingError).toBeNull();
  });

  it("double-submit: the second concurrent retry gets 409 and does NOT dispatch a second run", async () => {
    const storyId = await makeDraft(runtimeDb, eleanor);
    await markStoryProcessingFailed(runtimeDb, storyId, "render_story: retries exhausted");

    // First retry wins (clears the marker + dispatches).
    const first = await retryPOST(retryReq(`token=${encodeURIComponent(token)}&storyId=${storyId}`));
    expect(first.status).toBe(200);
    // A second retry after the marker is cleared (models the racing/double-click request) is a
    // benign 409 — the compare-and-swap in beginStoryRetry matched no row, so no second dispatch.
    const second = await retryPOST(retryReq(`token=${encodeURIComponent(token)}&storyId=${storyId}`));
    expect(second.status).toBe(409);
    expect(dispatchPipeline).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and does NOT dispatch when the draft has not failed", async () => {
    const storyId = await makeDraft(runtimeDb, eleanor); // processing, no failure marker
    const res = await retryPOST(
      retryReq(`token=${encodeURIComponent(token)}&storyId=${storyId}`),
    );
    expect(res.status).toBe(409);
    expect(dispatchPipeline).not.toHaveBeenCalled();
  });

  it("rejects an unknown token with 401", async () => {
    const storyId = await makeDraft(runtimeDb, eleanor);
    await markStoryProcessingFailed(runtimeDb, storyId, "x");
    const res = await retryPOST(retryReq(`token=not-real&storyId=${storyId}`));
    expect(res.status).toBe(401);
    expect(dispatchPipeline).not.toHaveBeenCalled();
  });

  it("rejects a story the token does not own with 404 (no leak)", async () => {
    const [stranger] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Stranger", spokenName: "Stranger" })
      .returning();
    const strangerStory = await makeDraft(runtimeDb, stranger!.id);
    await markStoryProcessingFailed(runtimeDb, strangerStory, "x");

    const res = await retryPOST(
      retryReq(`token=${encodeURIComponent(token)}&storyId=${strangerStory}`),
    );
    expect(res.status).toBe(404);
    expect(dispatchPipeline).not.toHaveBeenCalled();
  });

  it("rejects a missing parameter with 400", async () => {
    const res = await retryPOST(retryReq(`token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(400);
  });
});
