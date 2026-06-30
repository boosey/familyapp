import { test, expect } from "@playwright/test";
import { reseed, narratorTokenOf, wavPart, type SeedResult } from "./support/seed";

/**
 * The record → approve flow on the login-free narrator surface.
 *
 * The UI steps are voice-gated (MediaRecorder + spoken "approve aloud"), which is flaky to drive
 * headlessly — so this is a HYBRID: render assertions for what the pages deterministically show,
 * plus API-level integration of the real state transitions through the multipart capture/approve
 * seams. With the offline ScriptedTranscriber/ScriptedLanguageModel (no vendor keys), the whole
 * transcribe→render→pending_approval→shared path is deterministic.
 *
 * Each test reseeds (beforeEach) so it owns a fresh, unconsumed pending_approval story.
 */
test.describe("record → approve flow", () => {
  let seed: SeedResult;
  let token: string;

  test.beforeEach(async ({ request }) => {
    seed = await reseed(request);
    token = narratorTokenOf(seed);
  });

  /* ── Approval surface (UI render) ─────────────────────────────────────────── */

  test("the approval surface renders for a pending_approval story", async ({ page }) => {
    await page.goto(`/s/${token}/approve/${seed.draftStoryId}`);
    await expect(page.getByText("Ready to share this one?")).toBeVisible();
    await expect(page.getByText("Approve aloud")).toBeVisible();
    await expect(page.getByText("This one is already settled.")).toHaveCount(0);
  });

  test("the approval surface fails warmly for an unknown story", async ({ page }) => {
    await page.goto(`/s/${token}/approve/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByText("This one is already settled.")).toBeVisible();
  });

  /* ── Record (POST /api/capture) ───────────────────────────────────────────── */

  test("recording ingests audio and renders a pending_approval story", async ({ request, page }) => {
    const res = await request.post("/api/capture", { multipart: { token, audio: wavPart() } });
    const body = await res.json();
    expect(res.ok(), JSON.stringify(body)).toBeTruthy();
    expect(body.ok).toBe(true);
    expect(body.storyId).toBeTruthy();

    // The new story reached `pending_approval` through the offline transcribe→render pipeline:
    // its approval surface renders (not the "already settled" fallback).
    await page.goto(`/s/${token}/approve/${body.storyId}`);
    await expect(page.getByText("Ready to share this one?")).toBeVisible();
  });

  test("recording rejects an invalid session token (401)", async ({ request }) => {
    const res = await request.post("/api/capture", {
      multipart: { token: "not-a-real-token", audio: wavPart() },
    });
    expect(res.status()).toBe(401);
  });

  test("recording rejects empty audio (400)", async ({ request }) => {
    const res = await request.post("/api/capture", {
      multipart: { token, audio: { name: "empty.wav", mimeType: "audio/wav", buffer: Buffer.alloc(0) } },
    });
    expect(res.status()).toBe(400);
  });

  /* ── Approve (POST /api/capture/approve) ──────────────────────────────────── */

  test("approving shares the story and settles the surface", async ({ request, page }) => {
    const res = await request.post("/api/capture/approve", {
      multipart: { token, storyId: seed.draftStoryId, audienceTier: "family", audio: wavPart() },
    });
    const body = await res.json();
    expect(res.ok(), JSON.stringify(body)).toBeTruthy();
    expect(body.ok).toBe(true);

    // The story left `pending_approval` → the approval surface now shows the settled fallback.
    await page.goto(`/s/${token}/approve/${seed.draftStoryId}`);
    await expect(page.getByText("This one is already settled.")).toBeVisible();
  });

  test("approving rejects a non-shareable tier (400)", async ({ request }) => {
    const res = await request.post("/api/capture/approve", {
      multipart: { token, storyId: seed.draftStoryId, audienceTier: "private", audio: wavPart() },
    });
    expect(res.status()).toBe(400);
  });
});
