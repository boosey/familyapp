/**
 * Content WRITE path (audited). Together with authorization.ts, this is the only production code
 * permitted to touch the `stories`/`media` tables — keeping every content read AND write in a
 * tiny, reviewable surface.
 *
 * `persistRecordingAndCreateDraft` encodes the spec's capture invariant: the original audio
 * Media is written FIRST (and is immutable thereafter — the DB trigger forbids UPDATE/DELETE),
 * then a `draft` Story is created pointing at it. A draft story is born `private` (it stays
 * there until the elder approves by voice). The two writes are wrapped in a transaction so a
 * story can never exist without its canonical recording.
 *
 * `updateDerivedFields` and `transitionStoryState` are the pipeline's two narrow write seams:
 * they let transcription/synthesis fill in derived, regenerable fields and advance the lifecycle
 * (always via `assertStoryTransition`), without granting the pipeline raw table access.
 *
 * `getStoryAndRecordingForPipeline` is a tiny system-actor read for orchestration — its only
 * job is to hand the pipeline the storage key + idempotency-relevant story fields. It is NOT a
 * user-facing read; surfacing content to a viewer still goes through @chronicle/core's
 * authorization function. This stays inside the audited allowlist on purpose.
 */
import { eq } from "drizzle-orm";
import { media, stories } from "@chronicle/db/content";
import { persons } from "@chronicle/db/schema";
import type { Database, Media, Story, StoryState } from "@chronicle/db";
import { assertStoryTransition } from "./story-state";

export interface RecordingInput {
  ownerPersonId: string;
  /** Object-storage key where the immutable audio bytes already live. */
  storageKey: string;
  contentType: string;
  durationSeconds?: number;
  checksum: string;
}

export interface DraftStoryInput {
  /** The question that prompted this telling, if any. */
  promptQuestion?: string;
  /** The Ask this answers, if it came from the family relay. */
  askId?: string;
}

export interface PersistedRecording {
  recording: Media;
  story: Story;
}

/**
 * Persist the canonical recording, then create the draft Story that points at it. Call this only
 * AFTER the audio bytes are safely in object storage — so the recording is durable before any
 * downstream stage (transcription, synthesis) can run, and remains untouched if they all fail.
 */
export async function persistRecordingAndCreateDraft(
  db: Database,
  recording: RecordingInput,
  draft: DraftStoryInput = {},
): Promise<PersistedRecording> {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .insert(media)
      .values({
        ownerPersonId: recording.ownerPersonId,
        kind: "story_audio",
        storageKey: recording.storageKey,
        contentType: recording.contentType,
        durationSeconds: recording.durationSeconds ?? null,
        checksum: recording.checksum,
      })
      .returning();

    const [story] = await tx
      .insert(stories)
      .values({
        ownerPersonId: recording.ownerPersonId,
        recordingMediaId: rec!.id,
        state: "draft",
        audienceTier: "private",
        promptQuestion: draft.promptQuestion ?? null,
        askId: draft.askId ?? null,
      })
      .returning();

    return { recording: rec!, story: story! };
  });
}

/**
 * Derived, regenerable fields the pipeline writes (transcript + prose render). None of these
 * touch the canonical audio — the spec's "audio is the source of truth, prose is a derived,
 * clearly-secondary rendering" is enforced here by simply not providing a write path for the
 * recording pointer. Passing the same values twice is a no-op-equivalent (idempotent stages).
 */
export interface DerivedFields {
  transcript?: string;
  transcriptWordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
  prose?: string;
  title?: string;
  summary?: string;
  tags?: string[];
}

/** Update derived fields on a Story. Only the audited write surface touches the table. */
export async function updateDerivedFields(
  db: Database,
  storyId: string,
  fields: DerivedFields,
): Promise<Story> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.transcript !== undefined) patch.transcript = fields.transcript;
  if (fields.transcriptWordTimings !== undefined)
    patch.transcriptWordTimings = fields.transcriptWordTimings;
  if (fields.prose !== undefined) patch.prose = fields.prose;
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.summary !== undefined) patch.summary = fields.summary;
  if (fields.tags !== undefined) patch.tags = fields.tags;

  const [row] = await db
    .update(stories)
    .set(patch)
    .where(eq(stories.id, storyId))
    .returning();
  if (!row) throw new Error(`story not found: ${storyId}`);
  return row;
}

/**
 * Advance a Story's lifecycle state. ALWAYS routes through `assertStoryTransition` so an
 * illegal jump (e.g. draft -> shared, skipping approval) cannot be written, even from this
 * audited file. This is the wire-in of the state-machine guard the spine deferred (DECISIONS).
 */
export async function transitionStoryState(
  db: Database,
  storyId: string,
  to: StoryState,
): Promise<Story> {
  const [current] = await db
    .select({ state: stories.state })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!current) throw new Error(`story not found: ${storyId}`);
  if (current.state === to) {
    // Idempotent: re-applying the same state is a no-op. Read-back so callers get a fresh row.
    const [row] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    return row!;
  }
  assertStoryTransition(current.state, to);
  const [row] = await db
    .update(stories)
    .set({ state: to, updatedAt: new Date() })
    .where(eq(stories.id, storyId))
    .returning();
  return row!;
}

/**
 * What the pipeline orchestrator needs to do its job: the storage key of the canonical
 * recording, plus the small set of story fields that drive idempotency (state, transcript,
 * prose). This is a system-actor read — it does not surface content to a viewer; user-facing
 * reads still go through the authorization function. Kept narrow on purpose.
 */
export interface PipelineStoryView {
  storyId: string;
  ownerPersonId: string;
  /** The elder's spoken name + birthYear — the lightly-held context the renderer may use to
   * set tone (never to invent facts). Joined here so the pipeline does not have to call core
   * twice per stage. */
  ownerSpokenName: string;
  ownerBirthYear: number | null;
  state: StoryState;
  promptQuestion: string | null;
  transcript: string | null;
  prose: string | null;
  recording: {
    mediaId: string;
    storageKey: string;
    contentType: string;
    checksum: string;
    durationSeconds: number | null;
  };
}

export async function getStoryAndRecordingForPipeline(
  db: Database,
  storyId: string,
): Promise<PipelineStoryView | null> {
  const [row] = await db
    .select({
      id: stories.id,
      ownerPersonId: stories.ownerPersonId,
      ownerSpokenName: persons.spokenName,
      ownerBirthYear: persons.birthYear,
      state: stories.state,
      promptQuestion: stories.promptQuestion,
      transcript: stories.transcript,
      prose: stories.prose,
      mediaId: media.id,
      storageKey: media.storageKey,
      contentType: media.contentType,
      checksum: media.checksum,
      durationSeconds: media.durationSeconds,
    })
    .from(stories)
    .innerJoin(media, eq(media.id, stories.recordingMediaId))
    .innerJoin(persons, eq(persons.id, stories.ownerPersonId))
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!row) return null;
  return {
    storyId: row.id,
    ownerPersonId: row.ownerPersonId,
    ownerSpokenName: row.ownerSpokenName,
    ownerBirthYear: row.ownerBirthYear,
    state: row.state,
    promptQuestion: row.promptQuestion,
    transcript: row.transcript,
    prose: row.prose,
    recording: {
      mediaId: row.mediaId,
      storageKey: row.storageKey,
      contentType: row.contentType,
      checksum: row.checksum,
      durationSeconds: row.durationSeconds,
    },
  };
}
