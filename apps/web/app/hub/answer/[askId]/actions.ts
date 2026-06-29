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
import { augmentProfileFromStory } from "@chronicle/pipeline";
import { createCoreAnchorSource } from "@chronicle/interviewer";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export type ActionResult = { error: string } | undefined;

/**
 * Record an answer to an ask. Validates that the ask is targeted at the signed-in person,
 * then ingests the audio blob via the account capture path (actor.kind = "account") — the
 * personId is taken from the server session, never from the client.
 */
export async function recordAnswerAction(formData: FormData): Promise<ActionResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const audio = formData.get("audio");
  const askIdField = formData.get("askId");
  if (!(audio instanceof Blob) || typeof askIdField !== "string" || !askIdField) {
    return { error: hub.actions.invalidInput };
  }

  // Defense: confirm the ask is targeted at this exact person before recording anything.
  const [askRow] = await db
    .select({ targetPersonId: asks.targetPersonId, status: asks.status })
    .from(asks)
    .where(eq(asks.id, askIdField))
    .limit(1);
  if (!askRow || askRow.targetPersonId !== ctx.personId) {
    return { error: hub.actions.notForYou };
  }
  // Only queued/routed asks are answerable. Recording into an already-answered ask would create
  // a dead draft whose Share can never close (approveAndShareStory rejects a second answer for an
  // already-answered ask) — SF-4. Reject before ingesting anything.
  if (askRow.status !== "queued" && askRow.status !== "routed") {
    return { error: hub.actions.alreadyAnswered };
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: hub.actions.recordingEmpty };

  try {
    await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      askId: askIdField,
    });
  } catch {
    return { error: hub.actions.saveFailed };
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
  const { db, auth, newPipeline, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  const tierRaw = formData.get("audienceTier");
  if (typeof storyId !== "string" || !storyId || typeof tierRaw !== "string") {
    return { error: hub.actions.invalidInput };
  }

  const validTiers = ["family", "branch", "public"] as const;
  type ValidTier = (typeof validTiers)[number];
  if (!(validTiers as readonly string[]).includes(tierRaw)) {
    return { error: hub.actions.pickAudience };
  }
  const audienceTier = tierRaw as ValidTier;

  try {
    // Ownership check via the front door. The owner can always see their own story (any state).
    const story = await getStoryForViewer(db, ctx, storyId);
    if (!story || story.ownerPersonId !== ctx.personId) {
      return { error: hub.actions.storyNotFound };
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

    // Best-effort post-approval biographical augmentation: re-read the story (the top-of-function
    // read ran BEFORE the pipeline, so its transcript was null — the pipeline has now populated it),
    // then mine the transcript for any biographical-profile fields the narrator hasn't filled in
    // directly. augmentProfileFromStory only writes currently-null fields, so it never overwrites a
    // direct intake answer. Wrapped in its own try/catch so a failed inference can never FAIL the
    // Share. It IS awaited inline — one extra LLM round-trip before the redirect — consistent with
    // the pipeline's own inline LLM call above; a durable job queue could later move it off the
    // request path (Next server actions can't safely fire-and-forget after redirect).
    try {
      const approved = await getStoryForViewer(db, ctx, storyId);
      if (approved?.transcript) {
        await augmentProfileFromStory(
          approved.transcript,
          ctx.personId,
          languageModel,
          createCoreAnchorSource(db),
        );
      }
    } catch (e) {
      // Augmentation is a nice-to-have; swallow so the share + redirect always succeed. Log so a
      // silently-never-working feature still leaves a breadcrumb (matches the turn loop's
      // best-effort pattern for markRouted / intake extraction).
      // eslint-disable-next-line no-console
      console.warn("post-approval profile augmentation failed (story=%s):", storyId, e);
    }
  } catch {
    return { error: hub.actions.shareFailed };
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
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

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
    return { error: hub.actions.removeFailed };
  }
}
