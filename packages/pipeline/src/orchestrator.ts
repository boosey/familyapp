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
import {
  appendProseRevision,
  applyResolvedStoryDate,
  getNarratorBiographicalContext,
  listLifeEventsForPerson,
  markStoryProcessingFailed,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { getStoryAndRecordingForPipeline } from "@chronicle/core/pipeline";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import type {
  JobFailureInfo,
  JobName,
  StoryJobPayload,
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
import { deriveStoryDate } from "./derive-story-date";
import { AUDIO_SPEED_FACTOR_MAX, AUDIO_SPEED_FACTOR_MIN } from "./constants";
import { plog, startTimer } from "./logger";

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
  /**
   * Start the pipeline for a Story (enqueues the first stage). `attempt` (issue #11) is the retry
   * generation: omit it for the initial run; pass the bumped value from `beginStoryRetry` on a
   * narrator-initiated retry so the durable queue's payload-dedupe re-fires the stage.
   */
  start(storyId: string, attempt?: number): Promise<void>;
  /** Drain the queue (run all enqueued stages to completion). */
  runToCompletion(): Promise<void>;
  /** Direct stage entrypoints, exposed for tests that want to drive stages explicitly. */
  runTranscribeStage(payload: StoryJobPayload): Promise<void>;
  runRenderStoryStage(payload: StoryJobPayload): Promise<void>;
  /** Access to the queue for inspection. */
  readonly queue: JobQueue;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const transformer = deps.workingCopyTransformer ?? createDefaultWorkingCopyTransformer();
  const queue = deps.jobQueue ?? new InProcessJobQueue();

  // Carry the retry generation (issue #11) verbatim through internal cascades. `attempt` is only
  // present on a retried run; when omitted the payload — and therefore its dedupe id — is identical
  // to the initial run, so the normal path's queue behavior is unchanged.
  const withAttempt = (storyId: string, attempt: number | undefined): StoryJobPayload =>
    attempt === undefined ? { storyId } : { storyId, attempt };

  // Terminal-failure handler shared by both stages: a stage that exhausted the durable queue's
  // retries lands here (issue #11). Stamp a DB signal so the viewer-scoped status read can report
  // `failed` instead of an indefinite `processing`. Must not throw — it is the last-resort recorder.
  const onStageFailure = (stage: JobName) => async (
    payload: StoryJobPayload,
    error: JobFailureInfo,
  ): Promise<void> => {
    plog("pipeline", `${stage}: TERMINAL failure → marking story failed`, {
      story: payload.storyId,
      attempt: payload.attempt ?? 0,
      error: error.message,
    });
    // Never throw: this is the last-resort recorder. If even the DB write to record the failure
    // fails (transient outage), swallow + log rather than propagating into the queue's failure hook
    // — a throw here in prod would crash Inngest's onFailure callback and leave NO signal at all,
    // silently reverting to the exact "stuck in draft forever" bug this handler exists to prevent.
    try {
      await markStoryProcessingFailed(deps.db, payload.storyId, `${stage}: ${error.message}`);
    } catch (markErr) {
      plog("pipeline", `${stage}: FAILED to record terminal-failure signal`, {
        story: payload.storyId,
        error: markErr instanceof Error ? markErr.message : String(markErr),
      });
    }
  };

  const runTranscribeStage = async (payload: StoryJobPayload): Promise<void> => {
    const done = startTimer();
    plog("pipeline", "transcribe: begin", { story: payload.storyId });
    const view = await getStoryAndRecordingForPipeline(deps.db, payload.storyId);
    if (!view) {
      plog("pipeline", "transcribe: skip (story gone)", { story: payload.storyId, ms: done() });
      return; // story removed; nothing to do
    }
    // Defense in depth (ADR-0007): a text story has no audio to transcribe — its typed words are
    // already canonical in `transcript`. `start()` routes text stories straight to render_story, so
    // this stage should never see one; if it does (a stray enqueue), skip to render rather than
    // dereferencing a null recording below.
    if (view.kind === "text") {
      plog("pipeline", "transcribe: skip (text story) → enqueue render_story", {
        story: view.storyId,
        ms: done(),
      });
      await queue.enqueue("render_story", withAttempt(view.storyId, payload.attempt));
      return;
    }
    // Idempotency gate: if a transcript is already present, the stage has run. Skip the
    // expensive vendor call and just ensure render_story is enqueued (a retry of an already-
    // completed transcribe should still drive the pipeline forward).
    if (view.transcript !== null && view.transcript.length > 0) {
      plog("pipeline", "transcribe: skip (already transcribed) → enqueue render_story", {
        story: view.storyId,
        transcriptChars: view.transcript.length,
        ms: done(),
      });
      await queue.enqueue("render_story", withAttempt(view.storyId, payload.attempt));
      return;
    }

    // A voice story always has its canonical recording (schema CHECK: kind='voice' ⇒
    // recording_media_id NOT NULL). A null here means data corruption — fail loudly rather than
    // silently no-op. (Also narrows `recording` to non-null for the accesses below.)
    if (view.recording === null) {
      throw new Error(
        `voice story ${view.storyId} has no canonical recording (recording_media_id is null)`,
      );
    }
    const canonicalBytes = await deps.storage.getBytes(view.recording.storageKey);
    if (!canonicalBytes) {
      throw new Error(
        `canonical recording missing from storage: ${view.recording.storageKey}`,
      );
    }
    plog("pipeline", "transcribe: loaded canonical audio", {
      story: view.storyId,
      key: view.recording.storageKey,
      bytes: canonicalBytes.length,
      contentType: view.recording.contentType,
    });

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
    if (
      working.speedFactor < AUDIO_SPEED_FACTOR_MIN ||
      working.speedFactor > AUDIO_SPEED_FACTOR_MAX
    ) {
      throw new Error(
        `WorkingCopyTransformer reported out-of-spec speedFactor ${working.speedFactor} ` +
          `(must be 1.0..2.0); refusing to persist timings that would be silently wrong.`,
      );
    }
    plog("pipeline", "transcribe: working copy ready", {
      story: view.storyId,
      bytes: working.bytes.length,
      speedFactor: working.speedFactor,
      segments: working.segments.length,
      notes: working.notes,
    });

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

    // Record L1 prose provenance: the raw STT output with the transcriber model id.
    // Placed AFTER the idempotency early-return above, so re-runs never append a duplicate row.
    await appendProseRevision(deps.db, {
      storyId: view.storyId,
      level: "ai_transcribed",
      text: transcription.text,
      modelId: transcription.modelId,
    });
    plog("pipeline", "transcribe: persisted transcript + L1 provenance → enqueue render_story", {
      story: view.storyId,
      model: transcription.modelId,
      transcriptChars: transcription.text.length,
      words: wordTimings1x.length,
      ms: done(),
    });

    // Cascade to the next stage. enqueue dedupes by (name, storyId) while pending, so re-runs
    // of this stage do not pile up duplicate render_story jobs.
    await queue.enqueue("render_story", withAttempt(view.storyId, payload.attempt));
  };

  const runRenderStoryStage = async (payload: StoryJobPayload): Promise<void> => {
    const done = startTimer();
    plog("pipeline", "render: begin", { story: payload.storyId });
    const view = await getStoryAndRecordingForPipeline(deps.db, payload.storyId);
    if (!view) {
      plog("pipeline", "render: skip (story gone)", { story: payload.storyId, ms: done() });
      return;
    }
    if (view.transcript === null || view.transcript.length === 0) {
      // Out-of-order: the transcribe stage has not produced a transcript yet. Re-queue and
      // try again later. The in-proc queue runs FIFO so this self-corrects after transcribe
      // completes; a durable queue would naturally retry.
      plog("pipeline", "render: no transcript yet → re-enqueue transcribe", {
        story: view.storyId,
        ms: done(),
      });
      await queue.enqueue("transcribe", withAttempt(view.storyId, payload.attempt));
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
      plog("pipeline", "render: skip (already pending_approval with prose)", {
        story: view.storyId,
        proseChars: view.prose.length,
        ms: done(),
      });
      return;
    }
    plog("pipeline", "render: transcript ready → calling language model", {
      story: view.storyId,
      transcriptChars: view.transcript.length,
      hasPromptQuestion: view.promptQuestion !== null,
    });

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
    plog("pipeline", "render: persisted prose/title/summary/tags", {
      story: view.storyId,
      model: render.modelId,
      proseChars: render.prose.length,
      title: render.title,
      tags: render.tags.join(","),
    });

    // draft -> pending_approval. Story stays `private` (audienceTier is untouched). The
    // approval gate (Increment 5) is the only thing that may move it onward.
    await transitionStoryState(deps.db, view.storyId, "pending_approval");
    plog("pipeline", "render: draft → pending_approval", { story: view.storyId });

    // Append L2 LAST — after BOTH gate conditions (prose set AND state=pending_approval) are
    // committed — so any retry sees the gate satisfied and skips, never producing a duplicate
    // ai_cleaned row. (Mirrors the transcribe stage, whose gate condition also commits before
    // its L1 append.) Records the cleaned (Cleanup) output with the LM model id + exact system prompt.
    await appendProseRevision(deps.db, {
      storyId: view.storyId,
      level: "ai_cleaned",
      text: render.prose,
      modelId: render.modelId,
      promptText: render.systemPrompt,
    });
    plog("pipeline", "render: appended L2 provenance (done)", {
      story: view.storyId,
      model: render.modelId,
      ms: done(),
    });

    // Finish-time Story date backstop (ADR-0026, issue #246). The stage IS the finish line for a
    // pipeline-driven story, so anything still Undated here (a skipped temporal follow-up, an
    // import) gets its one silent second chance: the #242 resolver over the assembled transcript
    // against the narrator's birthDate + life events. The gate is `occurredKind === null` — a
    // story dated live during the interview is NEVER overwritten. Persistence goes through the
    // same `applyResolvedStoryDate` seam the live path uses; the provenance note carries the
    // backstop marker. Best-effort LAST: a backstop failure must never fail the render stage or
    // roll back the finished render — the story simply stays Undated.
    if (view.occurredKind === null) {
      try {
        const bio = await getNarratorBiographicalContext(deps.db, view.ownerPersonId);
        const lifeEvents = await listLifeEventsForPerson(deps.db, view.ownerPersonId);
        const backstop = deriveStoryDate({
          fullText: view.transcript,
          birthDate: bio?.birthDate ?? null,
          lifeEvents,
        });
        if (backstop.status === "resolved") {
          await applyResolvedStoryDate(deps.db, view.storyId, backstop.occurrence);
          plog("pipeline", "render: backstop dated story", {
            story: view.storyId,
            kind: backstop.occurrence.kind,
            date: backstop.occurrence.date,
            provenance: backstop.occurrence.provenance,
          });
        } else {
          plog("pipeline", "render: backstop found no date (story stays Undated)", {
            story: view.storyId,
          });
        }
      } catch (backstopErr) {
        plog("pipeline", "render: backstop FAILED (story left Undated)", {
          story: view.storyId,
          error:
            backstopErr instanceof Error ? backstopErr.message : String(backstopErr),
        });
      }
    }
  };

  queue.register("transcribe", runTranscribeStage, onStageFailure("transcribe"));
  queue.register("render_story", runRenderStoryStage, onStageFailure("render_story"));

  return {
    queue,
    runTranscribeStage,
    runRenderStoryStage,
    async start(storyId: string, attempt?: number) {
      // ADR-0007: a text story has no audio — route it straight to render_story, skipping
      // transcribe. A voice story (or a story that vanished) starts at transcribe as before.
      const view = await getStoryAndRecordingForPipeline(deps.db, storyId);
      const firstStage: JobName = view?.kind === "text" ? "render_story" : "transcribe";
      plog("pipeline", `start → enqueue ${firstStage}`, {
        story: storyId,
        kind: view?.kind,
        attempt: attempt ?? 0,
      });
      await queue.enqueue(firstStage, withAttempt(storyId, attempt));
    },
    async runToCompletion() {
      const done = startTimer();
      plog("pipeline", "runToCompletion: draining queue", { pending: queue.pending().length });
      await queue.drain();
      plog("pipeline", "runToCompletion: queue drained", { ms: done() });
    },
  };
}

export type { JobName, StoryJobPayload };
