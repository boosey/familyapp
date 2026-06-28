"use server";

/**
 * Server actions for the in-hub answer flow. Each action re-reads getRuntime() and
 * getCurrentAuthContext() on the server — personId is NEVER trusted from the client. This is the
 * security boundary: the audio blob and storyId come in via FormData, but the actor identity is
 * always derived from the server-side session.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { asks } from "@chronicle/db/schema";
import {
  getStoryForViewer,
  approveAndShareStory,
  discardDraftStory,
  updateDerivedFields,
} from "@chronicle/core";
import { ingestRecording } from "@chronicle/capture";
import { getRuntime } from "@/lib/runtime";

export type ActionResult = { error: string } | undefined;

/**
 * Record an answer to an ask. Validates that the ask is targeted at the signed-in person,
 * then ingests the audio blob via the account capture path (actor.kind = "account") — the
 * personId is taken from the server session, never from the client.
 */
export async function recordAnswerAction(formData: FormData): Promise<ActionResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "Not signed in." };

  const audio = formData.get("audio");
  const askIdField = formData.get("askId");
  if (!(audio instanceof Blob) || typeof askIdField !== "string" || !askIdField) {
    return { error: "Invalid input." };
  }

  // Defense: confirm the ask is targeted at this exact person before recording anything.
  const [askRow] = await db
    .select({ targetPersonId: asks.targetPersonId, status: asks.status })
    .from(asks)
    .where(eq(asks.id, askIdField))
    .limit(1);
  if (!askRow || askRow.targetPersonId !== ctx.personId) {
    return { error: "This question is not for you." };
  }
  // Only queued/routed asks are answerable. Recording into an already-answered ask would create
  // a dead draft whose Share can never close (approveAndShareStory rejects a second answer for an
  // already-answered ask) — SF-4. Reject before ingesting anything.
  if (askRow.status !== "queued" && askRow.status !== "routed") {
    return { error: "That question has already been answered." };
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: "Recording was empty. Please try again." };

  try {
    await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      askId: askIdField,
    });
  } catch {
    return { error: "Could not save your recording. Please try again." };
  }
}

/**
 * Share an answer: run the pipeline (transcribe + render, draft → pending_approval), then
 * approve+share (tap approval per ADR-0004 — no spoken approval clip). The pipeline is
 * idempotent: if the story is already pending_approval, the pipeline stages are no-ops.
 *
 * redirect("/hub") is called OUTSIDE the try/catch to avoid catching NEXT_REDIRECT.
 */
export async function shareAnswerAction(formData: FormData): Promise<ActionResult> {
  const { db, auth, newPipeline } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "Not signed in." };

  const storyId = formData.get("storyId");
  const tierRaw = formData.get("audienceTier");
  if (typeof storyId !== "string" || !storyId || typeof tierRaw !== "string") {
    return { error: "Invalid input." };
  }

  const validTiers = ["family", "branch", "public"] as const;
  type ValidTier = (typeof validTiers)[number];
  if (!(validTiers as readonly string[]).includes(tierRaw)) {
    return { error: "Please pick an audience before sharing." };
  }
  const audienceTier = tierRaw as ValidTier;

  try {
    // Ownership check via the front door. The owner can always see their own story (any state).
    const story = await getStoryForViewer(db, ctx, storyId);
    if (!story || story.ownerPersonId !== ctx.personId) {
      return { error: "Story not found." };
    }

    // Pipeline runs inline: transcribe → render_story → story moves to pending_approval.
    // Idempotent: if already pending_approval, both stages are no-ops. A FRESH pipeline (its own
    // in-process JobQueue) per share isolates concurrent approvals — a shared singleton queue
    // would interleave jobs across stories and corrupt state (SF-3).
    const pipeline = newPipeline();
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    // TEMPORARY (no-AI phase): until real transcription/rendering lands, the mock language model
    // derives every title from the same placeholder transcript, so all new cards look alike. Use
    // the question itself as the title instead — it's the most meaningful label we have without AI.
    // Remove this block once the real Groq/Anthropic adapters are producing genuine titles.
    if (story.askId) {
      const [askRow] = await db
        .select({ questionText: asks.questionText })
        .from(asks)
        .where(eq(asks.id, story.askId))
        .limit(1);
      if (askRow?.questionText) {
        await updateDerivedFields(db, storyId, { title: askRow.questionText });
      }
    }

    // Tap approval (ADR-0004): no approvalAudio clip. Consent record is written with
    // approvalAudioMediaId = NULL (the column is nullable since ADR-0004 landed).
    await approveAndShareStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
      audienceTier,
    });
  } catch {
    return { error: "Something went wrong sharing your story. Please try again." };
  }

  // Called outside try/catch: redirect() throws NEXT_REDIRECT which Next.js intercepts.
  redirect("/hub");
}

/**
 * Discard a never-consented draft (re-record supersession or explicit discard). DB row deleted
 * first (transactional), then best-effort blob cleanup. The domain enforces state = 'draft' and
 * ownership — only the narrator who owns the draft may discard it.
 */
export async function discardAnswerAction(formData: FormData): Promise<ActionResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "Not signed in." };

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: "Invalid input." };

  try {
    const { storageKeys } = await discardDraftStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
    });
    // Best-effort blob cleanup: a leaked object-storage key is harmless; a dangling DB row
    // is not — so the row was already removed transactionally above.
    for (const key of storageKeys) {
      await storage.delete(key).catch(() => {});
    }
  } catch {
    return { error: "Could not remove the recording. Please try again." };
  }
}
