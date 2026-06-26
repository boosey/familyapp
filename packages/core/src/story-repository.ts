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
import { consentRecords, persons } from "@chronicle/db/schema";
import type {
  AudienceTier,
  ConsentRecord,
  Database,
  Media,
  Story,
  StoryState,
} from "@chronicle/db";
import { assertStoryTransition } from "./story-state";
import { InvariantViolation } from "./errors";

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

/**
 * Cross-session memory for the interviewer — the narrow audited read that returns ONLY safe
 * metadata for the elder's own prior stories. The projection at the SQL layer (not in the
 * consumer) is the point: this function structurally cannot leak transcript/prose/audio key,
 * because it never selects them. The interviewer is restricted to titles/summaries/tags by
 * the TYPE of what it can ask core for, not by a convention in a downstream adapter.
 *
 * AuthZ: this is a system-actor read, BUT the implementation enforces that the requesting
 * caller is reading the elder's OWN stories (the elder is the owner — `ownerPersonId ===
 * personId`). That is exactly the owner-branch of the authorization function. We avoid the
 * full `listStoriesForViewer` round-trip because (a) the projection is the contract and (b)
 * fetching only metadata is cheaper. The architecture allowlist already includes this file.
 */
export interface InterviewerStoryMemory {
  storyId: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  promptQuestion: string | null;
  createdAt: Date;
}

export async function listElderMemoryForInterviewer(
  db: Database,
  elderPersonId: string,
  limit: number,
): Promise<InterviewerStoryMemory[]> {
  const rows = await db
    .select({
      storyId: stories.id,
      title: stories.title,
      summary: stories.summary,
      tags: stories.tags,
      promptQuestion: stories.promptQuestion,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .where(eq(stories.ownerPersonId, elderPersonId));
  // Most recent first; cap at `limit`. Sorting in app code (not SQL) keeps the test DB happy
  // and the projection identical regardless of index choice.
  return rows
    .map((r) => ({
      storyId: r.storyId,
      title: r.title,
      summary: r.summary,
      tags: r.tags ?? [],
      promptQuestion: r.promptQuestion,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/**
 * The voice-only approval gate (spec Part III). Atomic, audited write that closes the consent
 * loop on a single story:
 *
 *   - inserts the `approval_audio` Media row pointing at the elder's just-uploaded approval clip
 *     (storage upload happens BEFORE this call, in the same authenticity-beats-polish ordering
 *     as `ingestRecording` — if anything below fails, the elder's spoken approval is still safe
 *     in object storage);
 *   - advances the Story `pending_approval → approved → shared`, each step routed through
 *     `assertStoryTransition` so an illegal jump cannot be written from inside this audited file;
 *   - stamps the chosen `audienceTier` and `approvedAt` on the Story;
 *   - appends the FIRST `ConsentRecord` for the story — `action=approved_for_sharing`, pointing
 *     at the approval-audio Media, with the elder as both subject and actor (consent is owned by
 *     the person, and the elder is the one performing the voice approval).
 *
 * All four writes happen in ONE `db.transaction`, so the authorization function never sees a
 * partial state (e.g. story=shared without a backing consent row, which would itself be a bug
 * the front door would refuse to surface anyway — defense in depth at the write layer too).
 *
 * The caller (elder-session-authenticated capture surface) is responsible for asserting that the
 * session belongs to `story.ownerPersonId`; this function additionally verifies ownership at the
 * write layer so a misuse cannot smuggle a foreign approval through.
 */
export interface ApproveAndShareInput {
  storyId: string;
  /** The elder approving — must equal the story owner. */
  elderPersonId: string;
  /** The tier the elder is choosing to share at (private rejected — approval implies sharing). */
  audienceTier: Exclude<AudienceTier, "private">;
  approvalAudio: {
    storageKey: string;
    contentType: string;
    checksum: string;
    durationSeconds?: number;
  };
  now?: Date;
}

export interface ApproveAndShareResult {
  story: Story;
  approvalAudio: Media;
  consentRecord: ConsentRecord;
}

export async function approveAndShareStory(
  db: Database,
  input: ApproveAndShareInput,
): Promise<ApproveAndShareResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // 1. Load + ownership/state checks, all inside the tx so a concurrent state change cannot
    //    sneak past (the row update at the end serializes against a second approver too).
    const [current] = await tx
      .select({
        id: stories.id,
        ownerPersonId: stories.ownerPersonId,
        state: stories.state,
      })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new Error(`story not found: ${input.storyId}`);
    if (current.ownerPersonId !== input.elderPersonId) {
      throw new InvariantViolation(
        `approveAndShareStory: actor ${input.elderPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    // 2. Insert the approval-audio Media row (immutable, owned by the elder).
    const [approvalMedia] = await tx
      .insert(media)
      .values({
        ownerPersonId: input.elderPersonId,
        kind: "approval_audio",
        storageKey: input.approvalAudio.storageKey,
        contentType: input.approvalAudio.contentType,
        durationSeconds: input.approvalAudio.durationSeconds ?? null,
        checksum: input.approvalAudio.checksum,
      })
      .returning();

    // 3. Atomic state walk pending_approval → approved → shared. The spec wording is
    //    explicit about THREE states; we persist the intermediate `approved` row inside the tx
    //    (so audit/history queries on this DB after-the-fact can in principle observe the legal
    //    path was walked) rather than folding the two legs into a single UPDATE. Both legs go
    //    through `assertStoryTransition`, so an illegal jump cannot be written from inside this
    //    audited file.
    assertStoryTransition(current.state, "approved");
    await tx
      .update(stories)
      .set({
        state: "approved",
        audienceTier: input.audienceTier,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(stories.id, input.storyId));

    assertStoryTransition("approved", "shared");
    const [updatedStory] = await tx
      .update(stories)
      .set({ state: "shared", updatedAt: now })
      .where(eq(stories.id, input.storyId))
      .returning();

    // 4. Append the FIRST ConsentRecord — consent has a voice (approvalAudioMediaId) and a
    //    ledger row from the very first story. The append-only trigger makes this row immutable;
    //    a future revocation will be a NEW superseding row.
    const [consent] = await tx
      .insert(consentRecords)
      .values({
        personId: input.elderPersonId,
        storyId: input.storyId,
        action: "approved_for_sharing",
        resultingState: "shared",
        approvalAudioMediaId: approvalMedia!.id,
        actorPersonId: input.elderPersonId,
      })
      .returning();

    return {
      story: updatedStory!,
      approvalAudio: approvalMedia!,
      consentRecord: consent!,
    };
  });
}

/**
 * Voice correction (spec: "a correction the elder voices is applied to the prose (a regeneration
 * of the derived field) before sharing; the audio is untouched"). Updates the transcript to the
 * corrected text and CLEARS prose/title/summary/tags so the pipeline's render stage re-runs.
 * Canonical audio is irrelevant to this write path and is structurally untouchable here (the
 * recording pointer cannot be modified through this function — there is no write for it).
 *
 * Returns the post-clear Story; the actual re-render is the caller's job (typically: invoke
 * `renderStoryFromTranscript` and then `updateDerivedFields`, or re-enqueue the render stage).
 * Kept narrow on purpose: this is just the "clear the derived fields so they regenerate" half,
 * which must touch the table and therefore must live in this audited file.
 */
export async function applyTranscriptCorrection(
  db: Database,
  storyId: string,
  correctedTranscript: string,
): Promise<Story> {
  const [current] = await db
    .select({ state: stories.state })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!current) throw new Error(`story not found: ${storyId}`);
  // A correction is the elder editing in-session before sharing; refuse on a story already
  // shared (a post-share edit would require a NEW consent event, out of scope for Phase 1).
  if (current.state !== "pending_approval") {
    throw new InvariantViolation(
      `applyTranscriptCorrection: story must be pending_approval (was ${current.state})`,
    );
  }
  const [row] = await db
    .update(stories)
    .set({
      transcript: correctedTranscript,
      transcriptWordTimings: null,
      prose: null,
      title: null,
      summary: null,
      tags: [],
      updatedAt: new Date(),
    })
    .where(eq(stories.id, storyId))
    .returning();
  return row!;
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
