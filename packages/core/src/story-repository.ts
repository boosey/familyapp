/**
 * Content WRITE path (audited). Together with authorization.ts, this is the only production code
 * permitted to touch the `stories`/`media` tables — keeping every content read AND write in a
 * tiny, reviewable surface.
 *
 * `persistRecordingAndCreateDraft` encodes the spec's capture invariant: the original audio
 * Media is written FIRST (and is immutable thereafter — the DB trigger forbids UPDATE/DELETE),
 * then a `draft` Story is created pointing at it. A draft story is born `private` (it stays
 * there until the narrator approves by voice). The two writes are wrapped in a transaction so a
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
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { media, proseRevisions, stories } from "@chronicle/db/content";
import { asks, consentRecords, persons } from "@chronicle/db/schema";
import type {
  Ask,
  AudienceTier,
  ConsentRecord,
  Database,
  Media,
  ProseRevision,
  ProseRevisionLevel,
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
  /** The representative year the story is ABOUT (historical era), not when it was recorded. */
  eraYear?: number | null;
  /** Optional human display note for the era/place, e.g. "Naples" or "Cherry Street". */
  eraLabel?: string | null;
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
  if (fields.eraYear !== undefined) patch.eraYear = fields.eraYear;
  if (fields.eraLabel !== undefined) patch.eraLabel = fields.eraLabel;

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
  /** The narrator's spoken name + birthYear — the lightly-held context the renderer may use to
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
 * metadata for the narrator's own prior stories. The projection at the SQL layer (not in the
 * consumer) is the point: this function structurally cannot leak transcript/prose/audio key,
 * because it never selects them. The interviewer is restricted to titles/summaries/tags by
 * the TYPE of what it can ask core for, not by a convention in a downstream adapter.
 *
 * AuthZ: this is a system-actor read, BUT the implementation enforces that the requesting
 * caller is reading the narrator's OWN stories (the narrator is the owner — `ownerPersonId ===
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

export async function listNarratorMemoryForInterviewer(
  db: Database,
  narratorPersonId: string,
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
    .where(eq(stories.ownerPersonId, narratorPersonId));
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
 *   - inserts the `approval_audio` Media row pointing at the narrator's just-uploaded approval clip
 *     (storage upload happens BEFORE this call, in the same authenticity-beats-polish ordering
 *     as `ingestRecording` — if anything below fails, the narrator's spoken approval is still safe
 *     in object storage);
 *   - advances the Story `pending_approval → approved → shared`, each step routed through
 *     `assertStoryTransition` so an illegal jump cannot be written from inside this audited file;
 *   - stamps the chosen `audienceTier` and `approvedAt` on the Story;
 *   - appends the FIRST `ConsentRecord` for the story — `action=approved_for_sharing`, pointing
 *     at the approval-audio Media, with the narrator as both subject and actor (consent is owned by
 *     the person, and the narrator is the one performing the voice approval).
 *
 * All four writes happen in ONE `db.transaction`, so the authorization function never sees a
 * partial state (e.g. story=shared without a backing consent row, which would itself be a bug
 * the front door would refuse to surface anyway — defense in depth at the write layer too).
 *
 * The caller (narrator-session-authenticated capture surface) is responsible for asserting that the
 * session belongs to `story.ownerPersonId`; this function additionally verifies ownership at the
 * write layer so a misuse cannot smuggle a foreign approval through.
 */
export interface ApproveAndShareInput {
  storyId: string;
  /** The narrator approving — must equal the story owner. */
  narratorPersonId: string;
  /** The tier the narrator is choosing to share at (private rejected — approval implies sharing). */
  audienceTier: Exclude<AudienceTier, "private">;
  /**
   * The spoken-approval audio clip. OPTIONAL (ADR-0004): the in-hub flow approves with a TAP — the
   * just-recorded answer is the content, the tap is the consent act, and no second recording is
   * required. When omitted, the consent ledger row is written with `approvalAudioMediaId = NULL`
   * (the column is nullable); the row still records action/state/tier/actor/timestamp, so consent
   * is still audited — just without a voice artifact. The `/s/[token]` voice-approval surface still
   * passes it.
   */
  approvalAudio?: {
    storageKey: string;
    contentType: string;
    checksum: string;
    durationSeconds?: number;
  };
  now?: Date;
}

export interface ApproveAndShareResult {
  story: Story;
  /** The approval-audio Media row, or `null` for a tap approval (ADR-0004) with no voice clip. */
  approvalAudio: Media | null;
  consentRecord: ConsentRecord;
  /** The Ask that was flipped to `answered` in the same tx, if the Story pointed at one. */
  answeredAsk: Ask | null;
}

export async function approveAndShareStory(
  db: Database,
  input: ApproveAndShareInput,
): Promise<ApproveAndShareResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // 1. Load + ownership/state checks, all inside the tx so a concurrent state change cannot
    //    sneak past (the row update at the end serializes against a second approver too). Also
    //    pull `askId` so the asked-question relay's other end (Ask → answered) can close in
    //    the SAME transaction as the consent ledger entry.
    const [current] = await tx
      .select({
        id: stories.id,
        ownerPersonId: stories.ownerPersonId,
        state: stories.state,
        askId: stories.askId,
      })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new Error(`story not found: ${input.storyId}`);
    if (current.ownerPersonId !== input.narratorPersonId) {
      throw new InvariantViolation(
        `approveAndShareStory: actor ${input.narratorPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    // 2. Insert the approval-audio Media row (immutable, owned by the narrator) — ONLY when the
    //    narrator approved by voice. A tap approval (ADR-0004) has no clip, so no Media row is
    //    written and the consent record below points at NULL.
    let approvalMedia: Media | null = null;
    if (input.approvalAudio) {
      const [row] = await tx
        .insert(media)
        .values({
          ownerPersonId: input.narratorPersonId,
          kind: "approval_audio",
          storageKey: input.approvalAudio.storageKey,
          contentType: input.approvalAudio.contentType,
          durationSeconds: input.approvalAudio.durationSeconds ?? null,
          checksum: input.approvalAudio.checksum,
        })
        .returning();
      approvalMedia = row!;
    }

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
        personId: input.narratorPersonId,
        storyId: input.storyId,
        action: "approved_for_sharing",
        resultingState: "shared",
        approvalAudioMediaId: approvalMedia?.id ?? null,
        actorPersonId: input.narratorPersonId,
      })
      .returning();

    // 5. If this Story was created in response to an Ask, atomically flip the Ask to
    //    `answered` and point it at this Story — closing the relay's second half (spec Part
    //    III, "on approval, the Ask flips to `answered` with a pointer to the Story, and the
    //    answer is delivered back to the asker"). Folding this into the same tx as the consent
    //    write means the asker never sees an "approved story without an answered ask" or vice
    //    versa. Legal source states are `queued` (narrator answered without pre-routing) and
    //    `routed` (interviewer marked it). `answered` with same storyId is idempotent; with a
    //    different storyId raises — an Ask answers exactly one Story.
    let answeredAsk: Ask | null = null;
    if (current.askId !== null) {
      const [askCurrent] = await tx
        .select({ status: asks.status, storyId: asks.storyId })
        .from(asks)
        .where(eq(asks.id, current.askId))
        .limit(1);
      if (!askCurrent) {
        throw new InvariantViolation(
          `story ${input.storyId} references missing ask ${current.askId}`,
        );
      }
      if (askCurrent.status === "answered" && askCurrent.storyId !== input.storyId) {
        throw new InvariantViolation(
          `ask ${current.askId} already answered by a different story`,
        );
      }
      if (askCurrent.status !== "answered") {
        const [askRow] = await tx
          .update(asks)
          .set({
            status: "answered",
            storyId: input.storyId,
            answeredAt: now,
            updatedAt: now,
          })
          .where(eq(asks.id, current.askId))
          .returning();
        answeredAsk = askRow!;
      } else {
        const [askRow] = await tx
          .select()
          .from(asks)
          .where(eq(asks.id, current.askId))
          .limit(1);
        answeredAsk = askRow!;
      }
    }

    return {
      story: updatedStory!,
      approvalAudio: approvalMedia,
      consentRecord: consent!,
      answeredAsk,
    };
  });
}

/**
 * Voice correction (spec: "a correction the narrator voices is applied to the prose (a regeneration
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
  // A correction is the narrator editing in-session before sharing; refuse on a story already
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

/**
 * Outstanding answer-drafts for a narrator — the record-now-approve-later state the Questions tab
 * needs to show "Review & approve" (with the recorded time) instead of "Answer". A draft is a
 * Story the narrator recorded against an Ask but has NOT yet approved: `state = 'draft'` AND
 * `askId IS NOT NULL`, owned by the narrator.
 *
 * This MUST live here (the audited write/read surface) because it reads the guarded `stories`
 * table — `asks.ts` cannot. The web layer merges this with `listPendingAsksForNarrator` (which
 * returns the still-pending Asks) to render the per-ask two-state affordance. Returned keyed by
 * Ask id; if more than one draft somehow points at the same Ask, the most recently recorded wins
 * (re-record + discard should keep this 1:1, but we never surface a stale earlier take).
 *
 * AuthZ: a system-actor read scoped to the narrator's OWN drafts (`ownerPersonId === narrator`) —
 * the owner branch of the authorization function. No content (transcript/prose/audio key) is
 * selected; only the lifecycle pointer + timestamp.
 */
export interface OutstandingAnswerDraft {
  /** The Ask this draft answers. */
  askId: string;
  /** The durable draft Story (reachable via `/hub/answer/[askId]` to resume/approve). */
  storyId: string;
  /** When the draft was recorded (its Story's createdAt). */
  recordedAt: Date;
}

export async function listOutstandingAnswerDrafts(
  db: Database,
  narratorPersonId: string,
): Promise<OutstandingAnswerDraft[]> {
  const rows = await db
    .select({
      askId: stories.askId,
      storyId: stories.id,
      recordedAt: stories.createdAt,
    })
    .from(stories)
    .where(
      and(
        eq(stories.ownerPersonId, narratorPersonId),
        eq(stories.state, "draft"),
        isNotNull(stories.askId),
      ),
    );
  // Most recent first, then keep one draft per ask (the latest take).
  const byAsk = new Map<string, OutstandingAnswerDraft>();
  for (const r of rows.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())) {
    const askId = r.askId!;
    if (!byAsk.has(askId)) {
      byAsk.set(askId, { askId, storyId: r.storyId, recordedAt: r.recordedAt });
    }
  }
  return [...byAsk.values()];
}

/**
 * Audited core DELETE path for a never-consented draft (ADR-0002).
 *
 * The two "discard" events (explicit narrator discard and re-record supersession) are the ONLY
 * paths that remove rows from the DB — everything else is append-only. This function is the sole
 * entry point for both: callers decide WHEN to invoke it; this function decides WHAT may be
 * deleted and in what ORDER, guaranteeing the invariant "consented audio is immutable forever".
 *
 * Deletion order — story row FIRST, then media row — is required by two constraints acting in
 * concert that the DB enforces independently of this application code:
 *
 *   (a) FK constraint: `stories.recording_media_id → media`. The story row holds the FK
 *       reference; Postgres refuses to delete the media row while any story points at it.
 *       Deleting the story first removes the reference, unlocking the media delete.
 *
 *   (b) The `chronicle_media_delete_guard` trigger (invariants.sql, ADR-0002) checks whether
 *       any story with `recording_media_id = OLD.id` has consent records (via an INNER JOIN
 *       on `consent_records`). With the story row gone, the INNER JOIN returns nothing, and
 *       the trigger permits the delete. If we tried media-first, the FK would RAISE before
 *       the trigger even ran.
 *
 * Why the CALLER deletes the blob (not us): a leaked object-storage blob is harmless — no user
 * can enumerate R2 keys and cost is negligible. A dangling DB row is not harmless: it would
 * confuse authorization, pipeline, and listing queries. The row goes transactionally first;
 * blob cleanup is best-effort after the commit. We return the keys so the caller can do it.
 */
export interface DiscardDraftResult {
  /** Storage keys the caller should best-effort delete from MediaStorage after the tx commits. */
  storageKeys: string[];
}

export async function discardDraftStory(
  db: Database,
  input: { storyId: string; narratorPersonId: string },
): Promise<DiscardDraftResult> {
  return db.transaction(async (tx) => {
    // 1. Load the story. Missing → InvariantViolation (the caller is performing a domain
    //    action on a specific story by ID; "not found" is a precondition failure).
    const [story] = await tx
      .select({
        id: stories.id,
        ownerPersonId: stories.ownerPersonId,
        state: stories.state,
        recordingMediaId: stories.recordingMediaId,
      })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!story) {
      throw new InvariantViolation(
        `discardDraftStory: story ${input.storyId} not found`,
      );
    }

    // 2. Ownership: only the narrator who owns the draft may discard it. A session-layer
    //    check in the caller is expected, but the domain write layer enforces it too.
    if (story.ownerPersonId !== input.narratorPersonId) {
      throw new InvariantViolation(
        `discardDraftStory: actor ${input.narratorPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    // 3. State: only `draft` stories are deletable. Once a story has left `draft` it may
    //    carry consent (pending_approval is the gate before approval; approved/shared carry
    //    consent records). ADR-0002: immutability protects CONSENTED audio; the draft is
    //    the ONLY consent-free, deletable state.
    if (story.state !== "draft") {
      throw new InvariantViolation(
        `discardDraftStory: story ${input.storyId} is not a draft (state=${story.state}); only never-consented drafts may be discarded`,
      );
    }

    // 4. Defense-in-depth: assert ZERO consent_records rows exist for this story. For a
    //    true draft this is normally impossible (the approval gate is the only path that
    //    writes consent rows, and it requires `pending_approval`), but the domain must NEVER
    //    delete consented audio regardless of state, so we check at the layer closest to the
    //    delete. The DB trigger is the structural backstop; this gives a clean domain error
    //    instead of a raw trigger RAISE propagating to the caller.
    const consentCheck = await tx
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(eq(consentRecords.storyId, input.storyId))
      .limit(1);
    if (consentCheck.length > 0) {
      throw new InvariantViolation(
        `discardDraftStory: story ${input.storyId} has consent records; consented audio is immutable forever`,
      );
    }

    // 5. Capture the recording's storageKey BEFORE deleting anything, so we can return it
    //    to the caller for best-effort blob cleanup. A draft has exactly one recording media
    //    (created atomically in persistRecordingAndCreateDraft); if it's missing the DB is
    //    already corrupt — surface it as an invariant failure.
    const [rec] = await tx
      .select({ storageKey: media.storageKey })
      .from(media)
      .where(eq(media.id, story.recordingMediaId))
      .limit(1);
    if (!rec) {
      throw new InvariantViolation(
        `discardDraftStory: recording media ${story.recordingMediaId} for story ${input.storyId} not found`,
      );
    }

    // 6. Delete in STORY-FIRST order (see JSDoc above for the FK + trigger rationale).
    await tx.delete(stories).where(eq(stories.id, input.storyId));
    await tx.delete(media).where(eq(media.id, story.recordingMediaId));

    return { storageKeys: [rec.storageKey] };
  });
}

/**
 * Append a row to the append-only prose provenance ledger. AI levels carry `modelId` (+ `promptText`
 * for the polished render); `human_corrected` carries `actorPersonId`. The trigger in invariants.sql
 * makes the row immutable. This holds prose content, so it lives in this audited file.
 */
export interface AppendProseRevisionInput {
  storyId: string;
  level: ProseRevisionLevel;
  text: string;
  modelId?: string | null;
  promptText?: string | null;
  actorPersonId?: string | null;
}

export async function appendProseRevision(
  db: Database,
  input: AppendProseRevisionInput,
): Promise<ProseRevision> {
  const [row] = await db
    .insert(proseRevisions)
    .values({
      storyId: input.storyId,
      level: input.level,
      text: input.text,
      modelId: input.modelId ?? null,
      promptText: input.promptText ?? null,
      actorPersonId: input.actorPersonId ?? null,
    })
    .returning();
  return row!;
}

/**
 * Read a story's full prose lineage in append order. ANALYTICS / OFFLINE-TOOLING ONLY — this
 * surfaces raw prose content with no AuthContext, so NO user-facing surface may call it. It lives
 * in this already-allowlisted file; the L2→L3 diff (ai_polished vs human_corrected) is the
 * prompt/model improvement signal.
 */
export async function listProseRevisions(
  db: Database,
  storyId: string,
): Promise<ProseRevision[]> {
  return db
    .select()
    .from(proseRevisions)
    .where(eq(proseRevisions.storyId, storyId))
    .orderBy(asc(proseRevisions.seq));
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
