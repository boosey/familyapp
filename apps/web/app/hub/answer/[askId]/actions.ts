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
  saveProseCorrection,
} from "@chronicle/core";
import { ingestRecording } from "@chronicle/capture";
import {
  augmentProfileFromStory,
  beginLogContext,
  plog,
  plogError,
  startTimer,
} from "@chronicle/pipeline";
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
  // Correlate every log line for this answer run (ingest → queue → stages → AI seams).
  beginLogContext();
  const { db, storage, auth, newPipeline } = await getRuntime();
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

  const totalTimer = startTimer();
  plog("answer", "recordAnswer: received", {
    person: ctx.personId,
    ask: askIdField,
    bytes: bytes.byteLength,
    contentType: audio.type || "audio/webm",
  });

  let storyId: string;
  try {
    const result = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      askId: askIdField,
    });
    storyId = result.storyId;
  } catch (err) {
    plogError("answer", "recordAnswer: ingest failed", {
      ask: askIdField,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
  plog("answer", "recordAnswer: ingested → draft story created", { story: storyId });

  // Render BEFORE review (prose-provenance design): transcribe → polish so the review phase can
  // show the polished prose for the narrator to read and edit. A fresh pipeline per call isolates
  // its in-process queue. Idempotent if re-run.
  try {
    const pipeline = newPipeline();
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
  } catch (err) {
    plogError("answer", "recordAnswer: render pipeline failed", {
      story: storyId,
      ms: totalTimer(),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
  plog("answer", "recordAnswer: complete (story pending_approval)", {
    story: storyId,
    ms: totalTimer(),
  });
}

/**
 * Share an answer: persists an optional prose correction (L3) if the narrator edited the
 * AI-polished prose, then approves+shares (tap approval per ADR-0004 — no spoken approval clip),
 * then augments the biographical profile from the transcript. The pipeline ran at record time
 * (recordAnswerAction), so the story is already pending_approval here.
 *
 * redirect("/hub") is called OUTSIDE the try/catch to avoid catching NEXT_REDIRECT.
 */
export async function shareAnswerAction(formData: FormData): Promise<ActionResult> {
  // Correlate every log line for this share run (approve/share → augmentation AI call).
  beginLogContext();
  const { db, auth, languageModel } = await getRuntime();
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

  const totalTimer = startTimer();
  plog("answer", "shareAnswer: begin", { story: storyId, person: ctx.personId, tier: audienceTier });

  try {
    // Ownership check via the front door. The owner can always see their own story (any state).
    const story = await getStoryForViewer(db, ctx, storyId);
    if (!story || story.ownerPersonId !== ctx.personId) {
      return { error: hub.actions.storyNotFound };
    }

    // Persist an optional prose correction (L3). Only sent when the narrator changed the
    // AI-polished prose in the review editor; otherwise the field is absent from FormData.
    // saveProseCorrection requires pending_approval (the pipeline set that at record time) and
    // the actor to be the owner (established above) — placed before approveAndShareStory, which
    // transitions the story to approved/shared.
    const correctedProse = formData.get("correctedProse");
    if (typeof correctedProse === "string" && correctedProse.length > 0) {
      await saveProseCorrection(db, {
        storyId,
        correctedProse,
        actorPersonId: ctx.personId,
      });
      plog("answer", "shareAnswer: saved L3 prose correction", {
        story: storyId,
        proseChars: correctedProse.length,
      });
    }

    // Tap approval (ADR-0004): no approvalAudio clip. Consent record is written with
    // approvalAudioMediaId = NULL (the column is nullable since ADR-0004 landed).
    await approveAndShareStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
      audienceTier,
    });
    plog("answer", "shareAnswer: approved & shared + consent recorded", {
      story: storyId,
      tier: audienceTier,
    });

    // Best-effort post-approval biographical augmentation: re-read the story after approval —
    // the pre-approval getStoryForViewer above was used only for the ownership check; a fresh
    // read fetches the now-approved (and possibly corrected) story, including its transcript.
    // Mine the transcript for biographical-profile fields the narrator hasn't filled in directly.
    // augmentProfileFromStory only writes currently-null fields, so it never overwrites a
    // direct intake answer. Wrapped in its own try/catch so a failed inference can never FAIL the
    // Share. It IS awaited inline — one extra LLM round-trip before the redirect; a durable job
    // queue could later move it off the request path (Next server actions can't safely
    // fire-and-forget after redirect).
    try {
      const approved = await getStoryForViewer(db, ctx, storyId);
      if (approved?.transcript) {
        plog("answer", "shareAnswer: augmenting profile from transcript", {
          story: storyId,
          transcriptChars: approved.transcript.length,
        });
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
      plogError("answer", "shareAnswer: profile augmentation failed (non-fatal)", {
        story: storyId,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  } catch {
    return { error: hub.actions.shareFailed };
  }

  plog("answer", "shareAnswer: complete → redirect /hub", { story: storyId, ms: totalTimer() });
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
