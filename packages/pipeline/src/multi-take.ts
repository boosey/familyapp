/**
 * Multi-take pipeline (ADR-0012) — per-take transcribe + stitch-then-polish-ONCE.
 *
 * The two-stage `createPipeline` flow in `orchestrator.ts` is the flag-off / thread-of-one path
 * and is left UNTOUCHED. This module is the flag-on path for a follow-up THREAD: each take is
 * transcribed as it is recorded (its transcript is the evaluator's input for the next follow-up),
 * and the expensive prose polish runs exactly ONCE — over the stitched transcript — when the
 * thread completes.
 *
 * Invariants mirror the orchestrator's transcribe stage:
 *   - The canonical take bytes are read from storage, transformed into a fresh working copy, and
 *     NEVER written back or aliased forward.
 *   - The out-of-spec speedFactor guard and the empty-transcript guard both fail loudly rather than
 *     persisting silently-wrong word timings or cascading a paid-vendor ping-pong.
 *   - The single content read of story/take metadata stays inside @chronicle/core (via the audited
 *     `@chronicle/core/pipeline` subpath). No vendor SDK is imported here.
 */
import {
  appendProseRevision,
  listStoryRecordings,
  transitionStoryState,
  updateDerivedFields,
  updateStoryRecordingTranscript,
} from "@chronicle/core";
import {
  getStoryAndRecordingForPipeline,
  getStoryRecordingForPipeline,
} from "@chronicle/core/pipeline";
import type { WordTiming } from "./contracts";
import { AUDIO_SPEED_FACTOR_MAX, AUDIO_SPEED_FACTOR_MIN } from "./constants";
import type { PipelineDeps } from "./orchestrator";
import { renderStoryFromTranscript } from "./render-story";
import {
  createDefaultWorkingCopyTransformer,
  mapWorkingCopyMsToOriginalMs,
} from "./working-copy";

/**
 * Transcribe ONE take (as recorded) and persist its transcript + 1x-mapped word timings. Mirrors
 * the orchestrator's transcribe stage but scoped to a single `story_recordings` row instead of the
 * story's canonical recording. Returns the take's text so a caller can feed the evaluator.
 */
export async function transcribeTakeToRecording(
  deps: Pick<PipelineDeps, "db" | "storage" | "transcriber" | "workingCopyTransformer">,
  storyRecordingId: string,
): Promise<{ transcript: string; modelId: string }> {
  const transformer = deps.workingCopyTransformer ?? createDefaultWorkingCopyTransformer();

  const take = await getStoryRecordingForPipeline(deps.db, storyRecordingId);
  if (!take) {
    throw new Error(`story recording not found: ${storyRecordingId}`);
  }

  const canonicalBytes = await deps.storage.getBytes(take.storageKey);
  if (!canonicalBytes) {
    throw new Error(`take recording missing from storage: ${take.storageKey}`);
  }

  // Working copy is a brand-new Uint8Array; the canonical take bytes are not aliased forward.
  const working = await transformer.transform({
    bytes: canonicalBytes,
    contentType: take.contentType,
  });
  // Defense in depth: refuse an out-of-spec time-stretch so wrong-by-Nx timings surface loudly at
  // the boundary rather than being persisted silently (identical guard to the orchestrator).
  if (
    working.speedFactor < AUDIO_SPEED_FACTOR_MIN ||
    working.speedFactor > AUDIO_SPEED_FACTOR_MAX
  ) {
    throw new Error(
      `WorkingCopyTransformer reported out-of-spec speedFactor ${working.speedFactor} ` +
        `(must be 1.0..2.0); refusing to persist timings that would be silently wrong.`,
    );
  }

  const transcription = await deps.transcriber.transcribe({
    bytes: working.bytes,
    contentType: working.contentType,
  });

  // Empty-transcript guard: treat "" as a terminal vendor failure and throw, leaving the take
  // untouched so a retry is a deliberate caller decision (no automatic paid-vendor ping-pong).
  if (transcription.text.length === 0) {
    throw new Error(
      `transcriber returned empty text for take ${storyRecordingId} — refusing to ` +
        `persist (would burn vendor calls). Investigate the recording or vendor.`,
    );
  }

  // Map word timings from working-copy time back to ORIGINAL 1x time (segment-table mapping).
  const wordTimings1x: WordTiming[] = transcription.words.map((w) => ({
    word: w.word,
    startMs: mapWorkingCopyMsToOriginalMs(w.startMs, working.speedFactor, working.segments),
    endMs: mapWorkingCopyMsToOriginalMs(w.endMs, working.speedFactor, working.segments),
  }));

  await updateStoryRecordingTranscript(deps.db, {
    storyRecordingId,
    transcript: transcription.text,
    transcriptWordTimings: wordTimings1x,
  });

  return { transcript: transcription.text, modelId: transcription.modelId };
}

/**
 * Stitch all of a story's per-take transcripts (position order) into one transcript, then run the
 * prose polish ONCE over the stitched text and land the story at `pending_approval`. This is the
 * expensive LLM call that the multi-take design defers to thread completion — it must not run per
 * take.
 */
export async function stitchAndRenderStory(
  deps: Pick<PipelineDeps, "db" | "languageModel">,
  storyId: string,
): Promise<void> {
  const takes = await listStoryRecordings(deps.db, storyId);
  const stitched = takes
    .map((t) => t.transcript?.trim())
    .filter((t): t is string => !!t && t.length > 0)
    .join("\n\n");

  await updateDerivedFields(deps.db, storyId, { transcript: stitched });

  // L1 provenance: the stitched raw transcript (no model id — this is assembled from per-take ASR).
  await appendProseRevision(deps.db, {
    storyId,
    level: "ai_transcribed",
    text: stitched,
  });

  // Owner/prompt context for the render. The view carries ownerSpokenName/ownerBirthYear/prompt.
  const view = await getStoryAndRecordingForPipeline(deps.db, storyId);
  const render = await renderStoryFromTranscript(deps.languageModel, {
    transcript: stitched,
    promptQuestion: view?.promptQuestion ?? null,
    ...(view?.ownerSpokenName ? { narratorSpokenName: view.ownerSpokenName } : {}),
    ...(view && view.ownerBirthYear !== null ? { narratorBirthYear: view.ownerBirthYear } : {}),
  });

  await updateDerivedFields(deps.db, storyId, {
    prose: render.prose,
    title: render.title,
    summary: render.summary,
    tags: render.tags,
  });

  await transitionStoryState(deps.db, storyId, "pending_approval");

  // L2 provenance LAST — after prose + state are committed — with the LM model id + exact prompt.
  await appendProseRevision(deps.db, {
    storyId,
    level: "ai_cleaned",
    text: render.prose,
    modelId: render.modelId,
    promptText: render.systemPrompt,
  });
}
