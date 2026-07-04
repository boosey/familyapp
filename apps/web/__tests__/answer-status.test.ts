/**
 * Status-read tests for slice 2b — exercised against the REAL @chronicle/core front door (no mocking
 * of getStoryForViewer), so the auth-gating is genuinely tested:
 *
 *   - the pure state→status mapper;
 *   - the link-session token route (GET /api/capture/status): processing/ready for the token's own
 *     stories, 401 for an unknown token, 404 for a story the token does not own.
 *
 * (The in-hub account-auth `getAnswerStatusAction` was removed in ADR-0014 Inc 3 slice 11 — the
 * composing surface no longer polls; only the link-session route remains.)
 *
 * The seeded graph (seedInto) provides a real Person (Eleanor), her link-session token, and a
 * pending_approval story; we add fresh `draft` stories via the audited core write path. `@/lib/runtime`
 * is mocked so getRuntime returns our test db + a settable AuthContext (no PGlite/server-only boot).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { persistRecordingAndCreateDraft } from "@chronicle/core";
import { persons } from "@chronicle/db/schema";
import { seedInto } from "../lib/dev-seed";
import { mapStoryStateToStatus } from "../lib/answer-status";

// Settable runtime: getRuntime() reads this at call time. The link-session route authenticates via the
// token (resolveLinkSession), not an account AuthContext, so no getCurrentAuthContext stub is needed.
let runtimeDb: Database;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: runtimeDb }),
}));

// Imported AFTER the mock is registered (this module imports getRuntime from @/lib/runtime).
import { GET as statusGET } from "@/app/api/capture/status/route";

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
let pendingStoryId: string; // seeded pending_approval story owned by Eleanor
let eleanorDraftId: string;
let strangerDraftId: string;

beforeAll(async () => {
  runtimeDb = await createTestDatabase();
  const seed = await seedInto(runtimeDb, new InMemoryMediaStorage());
  eleanor = seed.narratorPersonId!;
  token = seed.narratorToken!;
  pendingStoryId = seed.draftStoryId!; // historical name; it is pending_approval

  eleanorDraftId = await makeDraft(runtimeDb, eleanor);

  // A stranger with no family co-membership with Eleanor — owns a private draft Eleanor cannot read.
  const [stranger] = await runtimeDb
    .insert(persons)
    .values({ displayName: "Stranger", spokenName: "Stranger" })
    .returning();
  strangerDraftId = await makeDraft(runtimeDb, stranger!.id);
});

describe("mapStoryStateToStatus", () => {
  it("maps draft → processing and every rendered state → ready", () => {
    expect(mapStoryStateToStatus("draft")).toBe("processing");
    expect(mapStoryStateToStatus("pending_approval")).toBe("ready");
    expect(mapStoryStateToStatus("approved")).toBe("ready");
    expect(mapStoryStateToStatus("shared")).toBe("ready");
  });
});

function statusReq(qs: string): Request {
  return new Request(`http://localhost/api/capture/status?${qs}`);
}

describe("GET /api/capture/status (link-session token)", () => {
  it("returns processing for the token's own draft story", async () => {
    const res = await statusGET(
      statusReq(`token=${encodeURIComponent(token)}&storyId=${eleanorDraftId}`),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      status: "processing",
      storyId: eleanorDraftId,
    });
  });

  it("returns ready for the token's pending_approval story", async () => {
    const res = await statusGET(
      statusReq(`token=${encodeURIComponent(token)}&storyId=${pendingStoryId}`),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, status: "ready" });
  });

  it("rejects an unknown token with 401", async () => {
    const res = await statusGET(statusReq(`token=not-a-real-token&storyId=${eleanorDraftId}`));
    expect(res.status).toBe(401);
  });

  it("rejects a story the token does not own with 404 (no leak)", async () => {
    const res = await statusGET(
      statusReq(`token=${encodeURIComponent(token)}&storyId=${strangerDraftId}`),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a missing parameter with 400", async () => {
    const res = await statusGET(statusReq(`token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(400);
  });
});
