/**
 * Pipeline orchestrator — wires the Phase-1 stages together behind the JobQueue.
 *
 * Stages (per spec Part VI):
 *   1. transcribe     — load canonical audio (read-only) → WORKING COPY (separate Uint8Array) →
 *                       transcriber → map word timings back to 1x → persist transcript +
 *                       transcriptWordTimings via the audited core write path.
 *   2. render_story   — load story (must now have a transcript) → renderStoryFromTranscript →
 *                       persist prose/title/summary/tags → transitionStoryState(draft ->
 *                       pending_approval). Story stays `private` (no consent yet).
 *
 * Invariants:
 *   - The canonical audio bytes are read from storage but are NEVER written back, overwritten,
 *     or handed to a transformer that aliases them. The working-copy bytes are a fresh
 *     Uint8Array and are NOT persisted as a Media row — they are a transient artifact for
 *     transcription only (spec: "The working copy exists for exactly this one call and is then
 *     discarded; the original audio Media is untouched.").
 *   - Every state transition goes through `transitionStoryState`, which routes through
 *     `assertStoryTransition` — illegal jumps cannot be written even from inside the pipeline.
 *   - Each stage is idempotent: re-running with the same inputs produces the same outputs and
 *     does not duplicate side effects. The check is: if the story already has the derived
 *     field this stage produces AND the input is unchanged, skip the vendor call.
 *   - All reads of Story/Media content stay inside @chronicle/core (via
 *     getStoryAndRecordingForPipeline, on the audited file). The pipeline never imports the
 *     content tables itself — the architecture guard enforces this.
 *   - No vendor SDK is imported anywhere in this package; vendors are reached only through the
 *     interfaces in contracts.ts.
 */
import { transitionStoryState, updateDerivedFields } from "@chronicle/core";
import { getStoryAndRecordingForPipeline } from "@chronicle/core/pipeline";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import type {
  JobName,
  JobPayload,
  JobQueue,
  LanguageModel,
  Transcriber,
  WordTiming,
  WorkingCopyTransformer,
} from "./contracts";
import { InProcessJobQueue } from "./job-queue";
import {
  mapWorkingCopyMsToOriginalMs,
  createDefaultWorkingCopyTransformer,
} from "./working-copy";
import { renderStoryFromTranscript } from "./render-story";

export interface PipelineDeps {
  db: Database;
  storage: MediaStorage;
  transcriber: Transcriber;
  languageModel: LanguageModel;
  /** Defaults to the dependency-free stub transformer (1.6x, single segment). */
  workingCopyTransformer?: WorkingCopyTransformer;
  /** Defaults to a fresh `InProcessJobQueue`. Production passes the Inngest adapter. */
  jobQueue?: JobQueue;
}

export interface Pipeline {
  /** Start the pipeline for a Story (enqueues the first stage). */
  start(storyId: string): Promise<void>;
  /** Drain the queue (run all enqueued stages to completion). */
  runToCompletion(): Promise<void>;
  /** Direct stage entrypoints, exposed for tests that want to drive stages explicitly. */
  runTranscribeStage(payload: JobPayload): Promise<void>;
  runRenderStoryStage(payload: JobPayload): Promise<void>;
  /** Access to the queue for inspection. */
  readonly queue: JobQueue;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const transformer = deps.workingCopyTransformer ?? createDefaultWorkingCopyTransformer();
  const queue = deps.jobQueue ?? new InProcessJobQueue();

  const runTranscribeStage = async (payload: JobPayload): Promise<void> => {
    const view = await getStoryAndRecordingForPipeline(deps.db, payload.storyId);
    if (!view) return; // story removed; nothing to do
    // Idempotency gate: if a transcript is already present, the stage has run. Skip the
    // expensive vendor call and just ensure render_story is enqueued (a retry of an already-
    // completed transcribe should still drive the pipeline forward).
    if (view.transcript !== null && view.transcript.length > 0) {
      await queue.enqueue("render_story", { storyId: view.storyId });
      return;
    }

    const canonicalBytes = await deps.storage.getBytes(view.recording.storageKey);
    if (!canonicalBytes) {
      throw new Error(
        `canonical recording missing from storage: ${view.recording.storageKey}`,
      );
    }

    // Working copy is a brand-new Uint8Array. The canonical bytes are not aliased forward.
    const working = await transformer.transform({
      bytes: canonicalBytes,
      contentType: view.recording.contentType,
      ...(view.recording.durationSeconds !== null
        ? { durationSeconds: view.recording.durationSeconds }
        : {}),
    });
    // Defense in depth: the spec hard-caps time-stretch at ~2x. A buggy real adapter that
    // reports a higher factor would silently miscompute persisted timings. Refuse here so the
    // bug surfaces loudly at the orchestrator boundary rather than as wrong-by-Nx word offsets.
    if (working.speedFactor < 1.0 || working.speedFactor > 2.0) {
      throw new Error(
        `WorkingCopyTransformer reported out-of-spec speedFactor ${working.speedFactor} ` +
          `(must be 1.0..2.0); refusing to persist timings that would be silently wrong.`,
      );
    }

    const transcription = await deps.transcriber.transcribe({
      bytes: working.bytes,
      contentType: working.contentType,
    });

    // Empty-transcript guard. If the vendor returns "", persisting it and cascading would land
    // us in a ping-pong: render sees empty transcript → re-enqueues transcribe → re-calls the
    // paid vendor → returns "" again → repeat. Treat empty as a terminal vendor failure: throw
    // out of the stage (the queue's drain will surface the error to the caller) and leave the
    // story untouched (transcript still null), so a retry is a deliberate caller decision and
    // not an automatic vendor-cost burn.
    if (transcription.text.length === 0) {
      throw new Error(
        `transcriber returned empty text for story ${view.storyId} — refusing to ` +
          `cascade (would burn vendor calls). Investigate the recording or vendor.`,
      );
    }

    // Map word timings from working-copy time back to ORIGINAL 1x time (spec: "any word-level
    // timestamps come back in sped-up time and must be multiplied by the speed factor to map
    // back onto the 1x original" — we use the segment table for the precise mapping that also
    // accounts for VAD-removed silence).
    const wordTimings1x: WordTiming[] = transcription.words.map((w) => ({
      word: w.word,
      startMs: mapWorkingCopyMsToOriginalMs(w.startMs, working.speedFactor, working.segments),
      endMs: mapWorkingCopyMsToOriginalMs(w.endMs, working.speedFactor, working.segments),
    }));

    await updateDerivedFields(deps.db, view.storyId, {
      transcript: transcription.text,
      transcriptWordTimings: wordTimings1x,
    });

    // Cascade to the next stage. enqueue dedupes by (name, storyId) while pending, so re-runs
    // of this stage do not pile up duplicate render_story jobs.
    await queue.enqueue("render_story", { storyId: view.storyId });
  };

  const runRenderStoryStage = async (payload: JobPayload): Promise<void> => {
    const view = await getStoryAndRecordingForPipeline(deps.db, payload.storyId);
    if (!view) return;
    if (view.transcript === null || view.transcript.length === 0) {
      // Out-of-order: the transcribe stage has not produced a transcript yet. Re-queue and
      // try again later. The in-proc queue runs FIFO so this self-corrects after transcribe
      // completes; a durable queue would naturally retry.
      await queue.enqueue("transcribe", { storyId: view.storyId });
      return;
    }
    // Idempotency gate: if prose is already populated AND the story has already reached
    // pending_approval, the stage is done. Re-running otherwise would just regenerate prose
    // (a derived field) — that is intentional and safe (the spec calls prose regenerable).
    //
    // REGENERATION CONTRACT: to re-render after a model upgrade or after the transcript
    // changes, the caller must clear the downstream derived field (`prose`) — only then will
    // this stage re-call the LLM. This is the spec's "first-write does NOT win" rule made
    // explicit: derived fields are not sticky, they are gated on emptiness.
    if (view.prose !== null && view.prose.length > 0 && view.state === "pending_approval") {
      return;
    }

    const render = await renderStoryFromTranscript(deps.languageModel, {
      transcript: view.transcript,
      promptQuestion: view.promptQuestion,
      narratorSpokenName: view.ownerSpokenName,
      ...(view.ownerBirthYear !== null ? { narratorBirthYear: view.ownerBirthYear } : {}),
    });

    await updateDerivedFields(deps.db, view.storyId, {
      prose: render.prose,
      title: render.title,
      summary: render.summary,
      tags: render.tags,
    });

    // draft -> pending_approval. Story stays `private` (audienceTier is untouched). The
    // approval gate (Increment 5) is the only thing that may move it onward.
    await transitionStoryState(deps.db, view.storyId, "pending_approval");
  };

  queue.register("transcribe", runTranscribeStage);
  queue.register("render_story", runRenderStoryStage);

  return {
    queue,
    runTranscribeStage,
    runRenderStoryStage,
    async start(storyId: string) {
      await queue.enqueue("transcribe", { storyId });
    },
    async runToCompletion() {
      await queue.drain();
    },
  };
}

export type { JobName, JobPayload };
