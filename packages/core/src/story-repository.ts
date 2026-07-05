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
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  media,
  proseRevisions,
  stories,
  storyImages,
  storyRecordings,
  storyFavorites,
  storyLikes,
} from "@chronicle/db/content";
import {
  askFamilies,
  asks,
  consentRecords,
  memberships,
  persons,
  storyFamilies,
  storyViews,
  followUpDecisions,
} from "@chronicle/db/schema";
import type {
  Ask,
  AudienceTier,
  ConsentRecord,
  Database,
  Media,
  ProseRevision,
  ProseRevisionLevel,
  Story,
  StoryKind,
  StoryRecording,
  StoryState,
  StoryFavorite,
  StoryLike,
} from "@chronicle/db";
import { assertStoryTransition } from "./story-state";
import { InvariantViolation } from "./errors";
import { AuthContext, getStoryForViewer, decideStoryRead, viewerPersonId } from "./authorization";
// The subject-photo cover insert routes through `attachPhotoToStoryTx`, which embeds the consolidated
// `assertPersonCanAccessAlbumPhoto` gate (existence + soft-delete + owner-can-see) IN the creation tx —
// so there is exactly ONE gate choke point, not a redundant second call here.
import { attachPhotoToStoryTx } from "./story-image-repository";

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
  /**
   * The family the recording was captured for (the link-session's family). Recorded on the story
   * as its originating context so approval can DEFAULT-target it into that family (ADR-0010).
   * Absent for the in-hub account capture path, which carries no session family.
   */
  originatingFamilyId?: string;
  /**
   * The album photo this story is ABOUT (ADR-0009 Phase 3 "subject"). When set, the story is stamped
   * with `subject_photo_id` AND the photo is atomically inserted as the story's FIRST `story_images`
   * cover row — the owner must be able to SEE the photo (gate enforced in the same tx).
   */
  subjectPhotoId?: string;
}

export interface PersistedRecording {
  recording: Media;
  story: Story;
}

export interface TextDraftInput {
  ownerPersonId: string;
  /** The typed words — canonical for a text story. Must be non-empty (trimmed). */
  text: string;
  /** The question that prompted this telling, if any. */
  promptQuestion?: string;
  /** The Ask this answers, if it came from the family relay. */
  askId?: string;
  /** The originating family context (ADR-0010), if captured for a specific family. */
  originatingFamilyId?: string;
  /**
   * The album photo this text story is ABOUT (ADR-0009 Phase 3 "subject"). See `DraftStoryInput`.
   */
  subjectPhotoId?: string;
}

export interface CreatedTextDraft {
  story: Story;
}

/**
 * Create a BARE TEXT-origin draft Story (ADR-0007 / ADR-0014 Inc 3): the typed words are canonical,
 * there is no recording. This creates ONLY the draft row — it does NOT persist the words. The typed
 * words are written by the caller via `appendTypedTakeContribution` (the single writer of the typed
 * take: it appends the `user_authored` provenance row AND sets the working prose). `text` is still
 * required here so the empty-after-trim guard rejects a blank telling before a row is created; the
 * trimmed value is not stored. No `media` row and no `story_recordings` row are created — the
 * kind⇔recording CHECK (invariants.sql) requires `recording_media_id IS NULL` for a text story,
 * which this satisfies.
 */
export async function createTextDraft(
  db: Database,
  input: TextDraftInput,
): Promise<CreatedTextDraft> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvariantViolation("a text story must have non-empty words");
  }
  return db.transaction(async (tx) => {
    const [story] = await tx
      .insert(stories)
      .values({
        ownerPersonId: input.ownerPersonId,
        kind: "text",
        recordingMediaId: null,
        state: "draft",
        audienceTier: "private",
        promptQuestion: input.promptQuestion ?? null,
        askId: input.askId ?? null,
        originatingFamilyId: input.originatingFamilyId ?? null,
        subjectPhotoId: input.subjectPhotoId ?? null,
      })
      .returning();

    // NOTE (ADR-0014 Inc 3 slice 4 dedup, preserved across the master merge): createTextDraft does
    // NOT write the L1 `user_authored` prose_revision here — the typed-append write path
    // (appendTypedTakeContribution) owns that now, so a bare draft carries no orphan revision.

    // ADR-0009 Phase 3: a subject photo is atomically the story's FIRST cover image. The gate inside
    // `attachPhotoToStoryTx` (existence + soft-delete + owner-can-see) runs in THIS tx before any
    // insert, so a story-from-a-photo the owner cannot see is rejected with NO story written.
    if (input.subjectPhotoId !== undefined) {
      await attachPhotoToStoryTx(tx, {
        storyId: story!.id,
        familyPhotoId: input.subjectPhotoId,
        attachedByPersonId: input.ownerPersonId,
      });
    }

    return { story: story! };
  });
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
        kind: "voice",
        recordingMediaId: rec!.id,
        state: "draft",
        audienceTier: "private",
        promptQuestion: draft.promptQuestion ?? null,
        askId: draft.askId ?? null,
        originatingFamilyId: draft.originatingFamilyId ?? null,
        subjectPhotoId: draft.subjectPhotoId ?? null,
      })
      .returning();

    // Seed the ordered take set with take 0 (the initial answer). The multi-take model (ADR-0012)
    // treats the canonical audio as this ordered set; recording_media_id stays the take-0 pointer.
    // Written unconditionally (even flag-off) so the data model is consistent everywhere.
    await tx.insert(storyRecordings).values({
      storyId: story!.id,
      position: 0,
      mediaId: rec!.id,
    });

    // ADR-0009 Phase 3: a subject photo is atomically the story's FIRST cover image (same gate/tx
    // discipline as `createTextDraft`). The owner is the attacher.
    if (draft.subjectPhotoId !== undefined) {
      await attachPhotoToStoryTx(tx, {
        storyId: story!.id,
        familyPhotoId: draft.subjectPhotoId,
        attachedByPersonId: recording.ownerPersonId,
      });
    }

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
  /** ADR-0007 origin type. `voice` ⇒ `recording` is populated; `text` ⇒ `recording` is null
   * (the typed words in `transcript` are canonical). The orchestrator branches on this to skip
   * `transcribe` for text stories. */
  kind: StoryKind;
  state: StoryState;
  promptQuestion: string | null;
  transcript: string | null;
  prose: string | null;
  /** The canonical recording. NULL for a text story (no audio) — the media join is a LEFT join
   * so a text draft still returns a view row. Always populated for a voice story. */
  recording: {
    mediaId: string;
    storageKey: string;
    contentType: string;
    checksum: string;
    durationSeconds: number | null;
  } | null;
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
  /**
   * Explicit family targets chosen by the author at the share step (ADR-0010; multi-family picker).
   * When present and non-empty for a `family`/`branch` tier, these REPLACE the default-targeting
   * computation: the set is validated against the owner's ACTIVE memberships (a foreign family
   * throws) and written as the story's `story_families`. Absent/empty → the existing default rule
   * (originating family / ask families / sole active family / ambiguous) applies unchanged. Ignored
   * for `public`.
   */
  familyIds?: string[];
  now?: Date;
}

export interface ApproveAndShareResult {
  story: Story;
  /** The approval-audio Media row, or `null` for a tap approval (ADR-0004) with no voice clip. */
  approvalAudio: Media | null;
  consentRecord: ConsentRecord;
  /** The Ask that was flipped to `answered` in the same tx, if the Story pointed at one. */
  answeredAsk: Ask | null;
  /**
   * The families this story was DEFAULT-targeted into at approval (ADR-0010), so it is immediately
   * visible to co-members in the hub. Empty when the tier needs no targeting (`public`), when
   * targeting was already set explicitly before approval (in which case this reflects that set), or
   * when the default was ambiguous (multi-family narrator, no originating signal) and the story was
   * left owner-only pending an explicit choice — see `ambiguousDefaultTarget`.
   */
  targetedFamilyIds: string[];
  /**
   * True when a family/branch story could NOT be default-targeted because the narrator belongs to
   * more than one family and there was no originating signal to disambiguate. The story is shared
   * but owner-only until the narrator picks families explicitly. Surfaced (not silently swallowed)
   * so a caller/UI can prompt — this is the hook ADR-0010's futures list earmarks for LLM-suggested
   * targeting.
   */
  ambiguousDefaultTarget: boolean;
}

/**
 * The DEFAULT family-target rule (ADR-0010), applied by approval-time targeting. Exported as a pure
 * function so the decision is unit-testable in isolation and reusable if a future import/repair path
 * ever needs the same logic. Given a story's originating signals and the owner's currently-active
 * families, decide which families a `family`/`branch` story is surfaced into by default:
 *   1. Prefer explicit ORIGINATING context — the family the recording was captured for, then the
 *      ask's family — restricted to families the owner is STILL active in.
 *   2. Else, if the owner is active in EXACTLY ONE family, target it (unambiguous; no leak possible).
 *      NOTE: if an originating family exists but the owner has LEFT it and is now sole-active in a
 *      DIFFERENT family, this surfaces the story into that other family. That is a conscious choice —
 *      it is the OWNER's own content following them to their current family, not a cross-person leak —
 *      but it does move a story into a family it was not originally told for.
 *   3. Else — owner active in several families with no originating signal — target NOTHING and flag
 *      `ambiguous`. NEVER "all owner families": that reintroduces the cross-family over-share ADR-0010
 *      exists to prevent (the Boudreaux/Carney case). Owner active in ZERO families ⇒ no targets,
 *      not ambiguous (there is simply nothing to surface into).
 */
export function computeDefaultFamilyTargets(args: {
  originatingFamilyId: string | null;
  askFamilyIds: string[];
  ownerActiveFamilyIds: Set<string>;
}): { targets: string[]; ambiguous: boolean } {
  const { originatingFamilyId, askFamilyIds, ownerActiveFamilyIds } = args;
  const originating = [
    ...new Set([originatingFamilyId, ...askFamilyIds]),
  ].filter((f): f is string => f !== null && ownerActiveFamilyIds.has(f));
  if (originating.length > 0) return { targets: originating, ambiguous: false };
  if (ownerActiveFamilyIds.size === 1) {
    return { targets: [...ownerActiveFamilyIds], ambiguous: false };
  }
  return { targets: [], ambiguous: ownerActiveFamilyIds.size > 1 };
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
        originatingFamilyId: stories.originatingFamilyId,
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
    // The ask's family context(s) (if any) are a secondary originating signal for default targeting
    // (step 6). An ask may now target one-or-more families (ask_families), so this is a set.
    let askFamilyIds: string[] = [];
    if (current.askId !== null) {
      const [askCurrent] = await tx
        .select({
          status: asks.status,
          storyId: asks.storyId,
        })
        .from(asks)
        .where(eq(asks.id, current.askId))
        .limit(1);
      if (!askCurrent) {
        throw new InvariantViolation(
          `story ${input.storyId} references missing ask ${current.askId}`,
        );
      }
      const askFamRows = await tx
        .select({ familyId: askFamilies.familyId })
        .from(askFamilies)
        .where(eq(askFamilies.askId, current.askId));
      askFamilyIds = askFamRows.map((r) => r.familyId);
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

    // 6. DEFAULT family targeting (ADR-0010). A `family`/`branch` story is invisible to co-members
    //    until it is surfaced into a family (`story_families`). Compute a conservative default IN
    //    THIS TX so an approved story is immediately visible where it was told — without ever
    //    leaking a multi-family narrator's story across families. Any EXISTING target set (an
    //    explicit pre-approval choice) WINS — we never overwrite it; `public`/`private`-excluded
    //    tiers skip this.
    //
    //    KNOWN LIMITATION: "explicit set" is inferred from the presence of ≥1 story_families row.
    //    An explicit *empty* set (a narrator clearing targeting to mean "owner-only at family tier")
    //    is indistinguishable from "never chosen", so it would be re-defaulted here. That path is
    //    unreachable today (no UI clears targeting before approval); if owner-only-at-family becomes
    //    a real user choice, add an explicit sentinel (e.g. a `targetingFinalized` flag) rather than
    //    overloading emptiness.
    let targetedFamilyIds: string[] = [];
    let ambiguousDefaultTarget = false;
    if (input.audienceTier === "family" || input.audienceTier === "branch") {
      const explicit = [...new Set(input.familyIds ?? [])];
      if (explicit.length > 0) {
        // Explicit author choice REPLACES the default computation (shared validate + replace-set).
        const written = await replaceStoryFamilyTargetsTx(
          tx,
          "approveAndShareStory",
          input.storyId,
          current.ownerPersonId,
          explicit,
        );
        targetedFamilyIds = [...written].sort();
      } else {
        const existing = await tx
          .select({ familyId: storyFamilies.familyId })
          .from(storyFamilies)
          .where(eq(storyFamilies.storyId, input.storyId))
          .orderBy(storyFamilies.familyId);
        if (existing.length > 0) {
          targetedFamilyIds = existing.map((r) => r.familyId);
        } else {
          const ownerActive = await tx
            .select({ familyId: memberships.familyId })
            .from(memberships)
            .where(
              and(
                eq(memberships.personId, current.ownerPersonId),
                eq(memberships.status, "active"),
              ),
            );
          const { targets, ambiguous } = computeDefaultFamilyTargets({
            originatingFamilyId: current.originatingFamilyId,
            askFamilyIds,
            ownerActiveFamilyIds: new Set(ownerActive.map((r) => r.familyId)),
          });
          ambiguousDefaultTarget = ambiguous;
          if (targets.length > 0) {
            await tx
              .insert(storyFamilies)
              .values(targets.map((familyId) => ({ storyId: input.storyId, familyId })));
            targetedFamilyIds = targets;
          }
        }
      }
    }

    return {
      story: updatedStory!,
      approvalAudio: approvalMedia,
      consentRecord: consent!,
      answeredAsk,
      targetedFamilyIds,
      ambiguousDefaultTarget,
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
  return db.transaction(async (tx) => {
    // The tx is for this file's write-path convention + future-proofing, NOT TOCTOU closure: under
    // READ COMMITTED the authored-lineage SELECT and the UPDATE take separate snapshots, so a
    // concurrent authored-row insert between them isn't fenced (acceptable on the single-narrator
    // composing surface; truly closing it would need SELECT ... FOR UPDATE).
    const [current] = await tx
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
    // ADR-0014 §7: authored prose is never blindly regenerated. Refuse to null prose when the story
    // has any user_authored or human_corrected lineage row (typed takes / hand-edits), which
    // clearing-to-re-render would silently destroy. The block set is intentionally
    // user_authored/human_corrected ONLY — ai_polished (and ai_transcribed/ai_cleaned) are
    // regenerable AI output and are deliberately NOT protected, so a Polished-then-corrected
    // pure-voice story re-renders as expected.
    const authored = await tx
      .select({ id: proseRevisions.id })
      .from(proseRevisions)
      .where(
        and(
          eq(proseRevisions.storyId, storyId),
          inArray(proseRevisions.level, ["user_authored", "human_corrected"]),
        ),
      )
      .limit(1);
    if (authored.length > 0) {
      throw new InvariantViolation(
        `applyTranscriptCorrection: story ${storyId} has authored prose lineage ` +
          `(user_authored/human_corrected); its prose is authored and must never be regenerated (ADR-0014 §7)`,
      );
    }
    const [row] = await tx
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
  });
}

/**
 * Outstanding answer stories awaiting the narrator's review/approval — the record-at-capture state
 * the Questions tab needs to show "Review & approve" (with the recorded time) instead of "Answer".
 * A story is outstanding when `state = 'pending_approval'` AND `askId IS NOT NULL`, owned by the
 * narrator. Render now runs at record time, so a successful answer lands in `pending_approval` with
 * prose already populated; a leftover `draft` means record/render did not complete and is NOT a
 * ready-to-review answer.
 *
 * This MUST live here (the audited write/read surface) because it reads the guarded `stories`
 * table — `asks.ts` cannot. The web layer merges this with `listPendingAsksForNarrator` (which
 * returns the still-pending Asks) to render the per-ask two-state affordance. Returned keyed by
 * Ask id; if more than one pending-approval story points at the same Ask, the most recently
 * recorded wins (re-record + discard should keep this 1:1, but we never surface a stale take).
 *
 * AuthZ: a system-actor read scoped to the narrator's OWN stories (`ownerPersonId === narrator`) —
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

/**
 * A live or `pending_approval` draft — ask-backed OR self-initiated. The Stories tab resumes
 * self-initiated tellings (`askId === null`) from this general view; `listOutstandingAnswerDrafts`
 * (below) is the ask-only, `pending_approval`-only projection the Questions tab consumes.
 */
export interface OutstandingDraft {
  /** The durable draft Story (reachable to resume/approve). */
  storyId: string;
  /** The Ask this answers, or null for a self-initiated telling. */
  askId: string | null;
  /** Origin type — text-authored or voice-recorded (ADR-0007). */
  kind: "voice" | "text";
  /**
   * Lifecycle state — `draft` is a live composing surface (ADR-0014); `pending_approval` is ready
   * for the owner's review. Consumers that only want review-ready drafts filter on this.
   */
  state: "draft" | "pending_approval";
  /** When the draft was created (its Story's createdAt). */
  recordedAt: Date;
}

/**
 * All of a person's in-progress AND `pending_approval` drafts — ask-backed AND self-initiated —
 * most recent first. Since ADR-0014 a `draft` is a live composing surface that lingers (it no
 * longer auto-advances to `pending_approval`), so the resume lists must surface both states.
 *
 * This MUST live here (the audited read surface) because it reads the guarded `stories` table.
 * AuthZ: a system-actor read scoped to the person's OWN stories (`ownerPersonId === personId`) —
 * the owner branch of the authorization function. No content (transcript/prose/audio key) is
 * selected; only the lifecycle pointer, origin kind, and timestamp.
 */
export async function listOutstandingDrafts(
  db: Database,
  personId: string,
): Promise<OutstandingDraft[]> {
  const rows = await db
    .select({
      askId: stories.askId,
      storyId: stories.id,
      kind: stories.kind,
      state: stories.state,
      recordedAt: stories.createdAt,
    })
    .from(stories)
    .where(
      and(
        eq(stories.ownerPersonId, personId),
        inArray(stories.state, ["draft", "pending_approval"]),
      ),
    );
  return rows
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .map((r) => ({
      storyId: r.storyId,
      askId: r.askId,
      kind: r.kind,
      // The query restricts state to exactly these two values, so this narrow is accurate.
      state: r.state as "draft" | "pending_approval",
      recordedAt: r.recordedAt,
    }));
}

/**
 * Ask-backed subset — one draft per Ask (the latest take), keyed by Ask id. Unchanged behavior for
 * the Questions tab: it merges this with `listPendingAsksForNarrator` to render the per-ask
 * two-state affordance. Self-initiated (askId=null) drafts are excluded here, and — since the base
 * read widened to include live `draft` state (ADR-0014) — so are drafts not yet `pending_approval`:
 * the Questions tab surfaces only review-ready answers.
 */
export async function listOutstandingAnswerDrafts(
  db: Database,
  narratorPersonId: string,
): Promise<OutstandingAnswerDraft[]> {
  // `listOutstandingDrafts` returns most-recent-first, so the first row per ask is the latest take.
  const all = await listOutstandingDrafts(db, narratorPersonId);
  const byAsk = new Map<string, OutstandingAnswerDraft>();
  for (const r of all) {
    if (r.state !== "pending_approval") continue;
    if (r.askId === null) continue;
    if (!byAsk.has(r.askId)) {
      byAsk.set(r.askId, { askId: r.askId, storyId: r.storyId, recordedAt: r.recordedAt });
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

    await tx.execute(
      sql`select set_config('chronicle.cascade_delete_story', ${input.storyId}, true)`,
    );

    // 2. Ownership: only the narrator who owns the draft may discard it. A session-layer
    //    check in the caller is expected, but the domain write layer enforces it too.
    if (story.ownerPersonId !== input.narratorPersonId) {
      throw new InvariantViolation(
        `discardDraftStory: actor ${input.narratorPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    // 3. State: only `draft` and `pending_approval` stories are deletable. Both are consent-free:
    //    `draft` never reaches the approval gate; `pending_approval` is the pre-approval review
    //    window and consent is written ONLY by approveAndShareStory, which transitions OUT of
    //    pending_approval atomically — so a pending_approval story has zero consent rows.
    //    Step 4's zero-consent check is the real structural guarantee that consented audio is
    //    never deleted; this state gate is a fast-path guard that rejects post-approval states.
    //    ADR-0002.
    if (story.state !== "draft" && story.state !== "pending_approval") {
      throw new InvariantViolation(
        `discardDraftStory: story ${input.storyId} is in state=${story.state}; only consent-free stories (draft, pending_approval) may be discarded`,
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

    // 5. Gather EVERY take's media (the ordered take set, ADR-0012) plus the canonical recording
    //    pointer, so this whole-thread discard removes all of the draft's audio and returns every
    //    blob key for best-effort cleanup. `recording_media_id` is unioned in defensively (it is
    //    take 0, so it is normally already among the take rows — but a fixture/legacy story may
    //    lack a seeded story_recordings row). The recording media MUST resolve; if it's missing the
    //    DB is already corrupt — surface it as an invariant failure.
    const takeRows = await tx
      .select({ mediaId: storyRecordings.mediaId })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, input.storyId))
      .orderBy(storyRecordings.position);
    // recording media first, then any follow-up takes — a deterministic storageKeys order. A
    // TEXT story (ADR-0007) has `recordingMediaId = null` and no take rows, so it contributes NO
    // media; filter nulls out so a text discard removes zero media rows (and `inArray` never sees
    // a null id).
    const mediaIds = [
      ...new Set(
        [story.recordingMediaId, ...takeRows.map((t) => t.mediaId)].filter(
          (id): id is string => id !== null,
        ),
      ),
    ];
    // `inArray(col, [])` compiles to `IN ()`, which errors in Postgres/PGlite — only query when
    // there is at least one media row to fetch (a text story has none).
    const mediaRows =
      mediaIds.length > 0
        ? await tx
            .select({ id: media.id, storageKey: media.storageKey })
            .from(media)
            .where(inArray(media.id, mediaIds))
        : [];
    const keyById = new Map(mediaRows.map((m) => [m.id, m.storageKey]));
    // Only a VOICE story must resolve its canonical recording (missing ⇒ DB corruption). A text
    // story legitimately has no recording, so skip the guard when the pointer is null.
    if (story.recordingMediaId !== null && !keyById.has(story.recordingMediaId)) {
      throw new InvariantViolation(
        `discardDraftStory: recording media ${story.recordingMediaId} for story ${input.storyId} not found`,
      );
    }
    const storageKeys = mediaIds
      .map((id) => keyById.get(id))
      .filter((k): k is string => k !== undefined);

    await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, input.storyId));
    // Then the ordered take set: story_recordings.story_id → stories.id is a plain FK, so the take
    // rows must go before the story. The story is consent-free (asserted above), so the
    // story_recordings delete-guard trigger permits it.
    await tx.delete(storyRecordings).where(eq(storyRecordings.storyId, input.storyId));
    // Then the prose provenance rows. prose_revisions.story_id → stories.id is a plain FK, so any
    // revision rows must go before the story. A text draft (ADR-0007) ALWAYS carries a
    // `user_authored` L1; a rendered draft may carry AI levels too. The story is consent-free
    // (asserted above), so the prose_revisions delete-guard trigger permits it.
    await tx.delete(proseRevisions).where(eq(proseRevisions.storyId, input.storyId));
    // Then the accompaniment rows (ADR-0009). story_images.story_id → stories.id is a plain FK
    // (ON DELETE no action, mirroring story_families), so any attached-image rows must go before the
    // story. Detaching an image writes no consent — images are mutable presentation, off the ledger.
    await tx.delete(storyImages).where(eq(storyImages.storyId, input.storyId));
    await tx.delete(storyLikes).where(eq(storyLikes.storyId, input.storyId));
    await tx.delete(storyFavorites).where(eq(storyFavorites.storyId, input.storyId));
    await tx.delete(storyViews).where(eq(storyViews.storyId, input.storyId));
    await tx.delete(followUpDecisions).where(eq(followUpDecisions.storyId, input.storyId));
    await tx.update(asks).set({ storyId: null }).where(eq(asks.storyId, input.storyId));

    // 7. Then delete in STORY-FIRST order (see JSDoc above for the FK + trigger rationale): the
    //    story references the media (story is the CHILD of media there), so the story goes first,
    //    then every take's media row (all never-consented).
    await tx.delete(stories).where(eq(stories.id, input.storyId));
    // A text story has no media rows to delete; guard against `inArray(col, [])` (IN ()).
    if (mediaIds.length > 0) {
      await tx.delete(media).where(inArray(media.id, mediaIds));
    }

    return { storageKeys };
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
  /** ADR-0014 §2: the audio take this row derives from (per-take automatic levels). */
  storyRecordingId?: string | null;
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
      storyRecordingId: input.storyRecordingId ?? null,
    })
    .returning();
  return row!;
}

/** Concatenate a new segment onto prior working prose with a blank-line separator, skipping
 *  empty parts (ADR-0014: an empty Cleanup segment is a no-op, not a stray blank line). */
function concatProse(priorProse: string | null, segment: string): string {
  return [priorProse ?? "", segment]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Voice take contribution (ADR-0014 §4). Persists the two AUTOMATIC per-take provenance rows —
 * `ai_transcribed` (raw transcript) and `ai_cleaned` (disfluency-cleaned segment), both keyed to
 * the take (`storyRecordingId`) — then sets `stories.prose` to the prior working text plus the
 * cleaned segment (blank-line join). Asserts `kind='voice'` idempotently; the authoritative kind
 * flipper is `persistTakeRecording` (which flips a typed-first draft co-transactionally on take 0),
 * so this UPDATE is a defensive no-op re-assert for the already-voice draft. Owner + `draft`-gated.
 *
 * The new prose is authored from the caller-supplied `priorProse` (the client editor's current text),
 * NOT re-read from `stories.prose` — so the last writer wins and a concurrent polish/append in the
 * same draft is clobbered. Acceptable on the single-narrator composing surface.
 */
export async function appendVoiceTakeContribution(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    storyRecordingId: string;
    rawTranscript: string;
    cleanedSegment: string;
    transcribeModelId: string;
    cleanupModelId: string;
    cleanupPromptText: string;
    priorProse: string | null;
  },
): Promise<{ prose: string; appendedSegment: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state, kind: stories.kind })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) {
      throw new InvariantViolation(
        `appendVoiceTakeContribution: story ${input.storyId} not found`,
      );
    }
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `appendVoiceTakeContribution: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(
        `appendVoiceTakeContribution: story must be draft (was ${current.state})`,
      );
    }
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "ai_transcribed",
      text: input.rawTranscript,
      modelId: input.transcribeModelId,
      promptText: null,
      actorPersonId: null,
      storyRecordingId: input.storyRecordingId,
    });
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "ai_cleaned",
      text: input.cleanedSegment,
      modelId: input.cleanupModelId,
      promptText: input.cleanupPromptText,
      actorPersonId: null,
      storyRecordingId: input.storyRecordingId,
    });
    const prose = concatProse(input.priorProse, input.cleanedSegment);
    await tx
      .update(stories)
      .set({ prose, kind: "voice", updatedAt: new Date() })
      .where(eq(stories.id, input.storyId));
    return { prose, appendedSegment: input.cleanedSegment };
  });
}

/**
 * Typed take contribution (ADR-0014 §4). Appends ONE `user_authored` provenance row keyed to the
 * narrator (`actorPersonId`, `storyRecordingId=null` — a typed take has no audio) and concatenates
 * the text onto the prior working prose (blank-line join). Creates NO `story_recordings` row and
 * does NOT change `kind` — a typed contribution on a voice draft leaves it voice; on a text draft
 * leaves it text. Owner + `draft`-gated; empty/whitespace text rejected.
 *
 * The new prose is authored from the caller-supplied `priorProse` (the client editor's current text),
 * NOT re-read from `stories.prose` — so the last writer wins and a concurrent polish/append in the
 * same draft is clobbered. Acceptable on the single-narrator composing surface.
 */
export async function appendTypedTakeContribution(
  db: Database,
  input: { storyId: string; ownerPersonId: string; text: string; priorProse: string | null },
): Promise<{ prose: string; appendedSegment: string }> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvariantViolation(
      "appendTypedTakeContribution: a typed take must have non-empty text",
    );
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) {
      throw new InvariantViolation(
        `appendTypedTakeContribution: story ${input.storyId} not found`,
      );
    }
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `appendTypedTakeContribution: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(
        `appendTypedTakeContribution: story must be draft (was ${current.state})`,
      );
    }
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "user_authored",
      text,
      modelId: null,
      promptText: null,
      actorPersonId: input.ownerPersonId,
      storyRecordingId: null,
    });
    const prose = concatProse(input.priorProse, text);
    await tx
      .update(stories)
      .set({ prose, updatedAt: new Date() })
      .where(eq(stories.id, input.storyId));
    return { prose, appendedSegment: text };
  });
}

/**
 * Seal a composition (ADR-0014 §4). `finalText` is the client's final editor text; `metadata`
 * (title/summary/tags) is already derived by the caller. When `finalText` differs from the current
 * `stories.prose`, snapshots ONE `human_corrected` provenance row (the narrator's own final edit);
 * when they match, no correction row is written. Persists metadata + `finalText` and transitions
 * `draft → pending_approval` via `assertStoryTransition`. Owner + `draft`-gated. NEVER clears prose —
 * an empty/whitespace `finalText` is rejected. Returns the updated Story.
 */
export async function finishDraft(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    finalText: string;
    metadata: { title: string; summary: string; tags: string[] };
  },
): Promise<Story> {
  const finalText = input.finalText.trim();
  if (finalText.length === 0) {
    throw new InvariantViolation(
      "finishDraft: finalText must be non-empty (Finish never clears prose)",
    );
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        ownerPersonId: stories.ownerPersonId,
        state: stories.state,
        prose: stories.prose,
      })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) {
      throw new InvariantViolation(`finishDraft: story ${input.storyId} not found`);
    }
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `finishDraft: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(
        `finishDraft: story must be draft (was ${current.state})`,
      );
    }
    if (current.prose !== finalText) {
      await tx.insert(proseRevisions).values({
        storyId: input.storyId,
        level: "human_corrected",
        text: finalText,
        modelId: null,
        promptText: null,
        actorPersonId: input.ownerPersonId,
        storyRecordingId: null,
      });
    }
    assertStoryTransition(current.state, "pending_approval");
    const [row] = await tx
      .update(stories)
      .set({
        prose: finalText,
        title: input.metadata.title,
        summary: input.metadata.summary,
        tags: input.metadata.tags,
        state: "pending_approval",
        updatedAt: new Date(),
      })
      .where(eq(stories.id, input.storyId))
      .returning();
    return row!;
  });
}

/**
 * Log a manual Polish tap (ADR-0014 §4). Appends ONE `ai_polished` provenance row (carrying
 * `modelId` + `promptText`) AND updates `stories.prose` to the polished text — every Polish is
 * recorded, so the prose lineage stays complete. Owner-gated; allowed in `draft` AND
 * `pending_approval` (a narrator may polish while composing or while reviewing before approval).
 * Returns the updated Story.
 */
export async function logPolish(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    polishedProse: string;
    modelId: string;
    promptText: string;
  },
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) {
      throw new InvariantViolation(`logPolish: story ${input.storyId} not found`);
    }
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `logPolish: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft" && current.state !== "pending_approval") {
      throw new InvariantViolation(
        `logPolish: story must be draft or pending_approval (was ${current.state})`,
      );
    }
    // Trim so the stored prose is whitespace-normalized like `concatProse`/`finishDraft` — otherwise
    // a later no-op Finish would spuriously snapshot a `human_corrected` row differing only by
    // trailing whitespace.
    const polishedProse = input.polishedProse.trim();
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "ai_polished",
      text: polishedProse,
      modelId: input.modelId,
      promptText: input.promptText,
      actorPersonId: null,
      storyRecordingId: null,
    });
    const [row] = await tx
      .update(stories)
      .set({ prose: polishedProse, updatedAt: new Date() })
      .where(eq(stories.id, input.storyId))
      .returning();
    return row!;
  });
}

/**
 * Read a story's full prose lineage in append order. ANALYTICS / OFFLINE-TOOLING ONLY — this
 * surfaces raw prose content with no AuthContext, so NO user-facing surface may call it. It lives
 * in this already-allowlisted file; the L2→L3 diff (ai_cleaned vs human_corrected) is the
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

/**
 * Persist a narrator's DIRECT prose edit (L3) and append a `human_corrected` revision — in one tx.
 * Unlike `applyTranscriptCorrection`, this does NOT touch the transcript and does NOT re-run the
 * LLM: the human is the correction authority and AI runs only once (spec: prose-provenance design).
 * Gated to the owner and to `pending_approval` (a post-share edit would need a new consent event,
 * out of scope). Callers should only invoke this when the edited prose differs from the AI polish.
 */
export interface SaveProseCorrectionInput {
  storyId: string;
  correctedProse: string;
  /** The narrator editing — must equal the story owner. */
  actorPersonId: string;
}

export async function saveProseCorrection(
  db: Database,
  input: SaveProseCorrectionInput,
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new Error(`story not found: ${input.storyId}`);
    if (current.ownerPersonId !== input.actorPersonId) {
      throw new InvariantViolation(
        `saveProseCorrection: actor ${input.actorPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "pending_approval") {
      throw new InvariantViolation(
        `saveProseCorrection: story must be pending_approval (was ${current.state})`,
      );
    }
    const [row] = await tx
      .update(stories)
      .set({ prose: input.correctedProse, updatedAt: new Date() })
      .where(eq(stories.id, input.storyId))
      .returning();
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "human_corrected",
      text: input.correctedProse,
      actorPersonId: input.actorPersonId,
    });
    return row!;
  });
}

/**
 * Story→family targeting primitive (Mode 4, ADR-0010). REPLACES the story's target set with
 * `familyIds` (dedup'd): deletes the existing story_families rows for the story, then inserts the
 * given set. Targeting scopes which of the owner's families a `family`/`branch`-tier story is
 * surfaced into — the set the authorization function intersects with owner+viewer active
 * memberships.
 *
 * VALIDATION: every target family must be one the story's OWNER currently holds an ACTIVE
 * membership in — you cannot surface a story into a family the owner isn't in (that would be an
 * over-share the visibility rule would refuse anyway, but we reject it at the write layer so the
 * targeting set never contains a family that can never grant visibility). Violations throw
 * `InvariantViolation`. Passing `[]` clears targeting (story becomes owner-only).
 *
 * This is JUST the primitive — approval-time default targeting (the originating family context)
 * is a later increment and is intentionally NOT wired here.
 *
 * ACTOR AUTHORIZATION is the CALLER's responsibility. Like the other write primitives in this
 * file, `setStoryFamilyTargets` takes no `AuthContext`; it validates only that the targets are the
 * OWNER's families, not that the *actor* invoking it is allowed to retarget this story. Whoever
 * wires the approval/retargeting UI MUST gate the actor (story owner or family steward) before
 * calling this. It can never widen visibility beyond the owner's own families, so the blast radius
 * of a missing gate is bounded — but it is not a substitute for an actor check.
 */
/**
 * Shared story→family targeting REPLACE-SET, scoped to an EXISTING transaction — it does NOT open
 * its own `db.transaction`; the caller owns the tx. Validates every family in `familyIds` against
 * the story OWNER's ACTIVE memberships (a family the owner isn't active in throws
 * `InvariantViolation`), then replaces the story's `story_families` rows with the dedup'd set
 * (delete-all, then insert). Passing `[]` clears targeting. `context` prefixes the error message so
 * each caller's message reads true. Returns the dedup'd set actually written.
 *
 * Two callers share this: the public `setStoryFamilyTargets` primitive and `approveAndShareStory`'s
 * explicit multi-family picker branch — keeping the validate + replace logic (and its error wording)
 * in exactly one place.
 */
async function replaceStoryFamilyTargetsTx(
  tx: Pick<Database, "select" | "insert" | "delete">,
  context: string,
  storyId: string,
  ownerPersonId: string,
  familyIds: string[],
): Promise<string[]> {
  const unique = [...new Set(familyIds)];
  if (unique.length > 0) {
    // The families the owner is an ACTIVE member of — the only families a story may target.
    const ownerActive = await tx
      .select({ familyId: memberships.familyId })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, ownerPersonId),
          eq(memberships.status, "active"),
        ),
      );
    const ownerActiveSet = new Set(ownerActive.map((r) => r.familyId));
    for (const familyId of unique) {
      if (!ownerActiveSet.has(familyId)) {
        throw new InvariantViolation(
          `${context}: story owner ${ownerPersonId} is not an active member of ` +
            `family ${familyId}; cannot surface a story into a family its owner isn't in`,
        );
      }
    }
  }

  // Replace the target set: clear, then re-insert the validated, dedup'd families.
  await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, storyId));
  if (unique.length > 0) {
    await tx
      .insert(storyFamilies)
      .values(unique.map((familyId) => ({ storyId, familyId })));
  }
  return unique;
}

export async function setStoryFamilyTargets(
  db: Database,
  storyId: string,
  familyIds: string[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const [story] = await tx
      .select({ ownerPersonId: stories.ownerPersonId })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    if (!story) {
      throw new InvariantViolation(
        `setStoryFamilyTargets: story ${storyId} not found`,
      );
    }

    await replaceStoryFamilyTargetsTx(
      tx,
      "setStoryFamilyTargets",
      storyId,
      story.ownerPersonId,
      familyIds,
    );
  });
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
      kind: stories.kind,
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
    // LEFT join: a text story has recording_media_id = NULL and thus no media row. An INNER join
    // would drop the story entirely (zero rows → null view), making the pipeline treat a valid
    // text draft as "gone". LEFT join keeps the story row with recording columns NULL. A voice
    // story always has its media row, so its `recording` is populated exactly as before.
    .leftJoin(media, eq(media.id, stories.recordingMediaId))
    .innerJoin(persons, eq(persons.id, stories.ownerPersonId))
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!row) return null;
  return {
    storyId: row.id,
    ownerPersonId: row.ownerPersonId,
    ownerSpokenName: row.ownerSpokenName,
    ownerBirthYear: row.ownerBirthYear,
    kind: row.kind,
    state: row.state,
    promptQuestion: row.promptQuestion,
    transcript: row.transcript,
    prose: row.prose,
    // NULL for a text story (no media row from the LEFT join). `media.id` is NOT NULL in the
    // schema, so a null `mediaId` here can only mean "no joined recording".
    recording:
      row.mediaId === null
        ? null
        : {
            mediaId: row.mediaId,
            storageKey: row.storageKey!,
            contentType: row.contentType!,
            checksum: row.checksum!,
            durationSeconds: row.durationSeconds,
          },
  };
}

// ---------------------------------------------------------------------------
// Multi-take repository (ADR-0012). The canonical audio is an ORDERED SET of takes
// (`story_recordings`): position 0 is the initial answer, 1,2,… are follow-up takes, each with its
// own immutable Media (kind=story_audio) + derived transcript. These reads/writes touch the guarded
// content tables, so they live in this audited file. Takes are freely droppable pre-approval; the
// DB delete-guard freezes them once the story has a consent record.
// ---------------------------------------------------------------------------

/** Ordered takes for a story (position asc), including per-take transcript. Audited read. */
export async function listStoryRecordings(
  db: Database,
  storyId: string,
): Promise<StoryRecording[]> {
  return db
    .select()
    .from(storyRecordings)
    .where(eq(storyRecordings.storyId, storyId))
    .orderBy(storyRecordings.position);
}

/** Append a follow-up take at the next position. Media must already be persisted (immutable). */
export async function appendStoryRecording(
  db: Database,
  input: { storyId: string; mediaId: string },
): Promise<StoryRecording> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ position: storyRecordings.position })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, input.storyId))
      .orderBy(desc(storyRecordings.position))
      .limit(1);
    const nextPosition = (existing[0]?.position ?? -1) + 1;
    const [row] = await tx
      .insert(storyRecordings)
      .values({ storyId: input.storyId, position: nextPosition, mediaId: input.mediaId })
      .returning();
    return row!;
  });
}

/**
 * Persist a FOLLOW-UP take: insert its immutable story_audio Media + append it to the story's
 * ordered take set, atomically. Mirrors persistRecordingAndCreateDraft (audio bytes must ALREADY
 * be in object storage — the caller uploads first, storage-first, like ingestRecording). Does NOT
 * create a Story; the Story already exists (take 0). The next position = max(existing)+1.
 */
export async function persistTakeRecording(
  db: Database,
  recording: RecordingInput,
  storyId: string,
): Promise<{ recording: Media; storyRecording: StoryRecording }> {
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
    const existing = await tx
      .select({ position: storyRecordings.position })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, storyId))
      .orderBy(desc(storyRecordings.position))
      .limit(1);
    const nextPosition = (existing[0]?.position ?? -1) + 1;
    const [row] = await tx
      .insert(storyRecordings)
      .values({ storyId, position: nextPosition, mediaId: rec!.id })
      .returning();
    // ADR-0014 §3.3 (amended): the FIRST take on a typed-first (kind='text') draft flips
    // kind→voice CO-TRANSACTIONALLY, so the deferred biconditional holds at THIS commit. The
    // recording_media_id pointer is NOT re-aimed (it stays NULL — the take set is the audio).
    if (nextPosition === 0) {
      const [current] = await tx
        .select({ kind: stories.kind })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      if (current && current.kind === "text") {
        await tx
          .update(stories)
          .set({ kind: "voice", updatedAt: new Date() })
          .where(eq(stories.id, storyId));
      }
    }
    return { recording: rec!, storyRecording: row! };
  });
}

/** Pipeline read: the storage key + owner context for ONE take. System-actor (no viewer authz). */
export async function getStoryRecordingForPipeline(
  db: Database,
  storyRecordingId: string,
): Promise<{ storyId: string; storageKey: string; contentType: string } | null> {
  const [row] = await db
    .select({
      storyId: storyRecordings.storyId,
      storageKey: media.storageKey,
      contentType: media.contentType,
    })
    .from(storyRecordings)
    .innerJoin(media, eq(media.id, storyRecordings.mediaId))
    .where(eq(storyRecordings.id, storyRecordingId))
    .limit(1);
  return row ?? null;
}

/** Backfill a take's derived transcript (from the transcribe step). */
export async function updateStoryRecordingTranscript(
  db: Database,
  input: {
    storyRecordingId: string;
    transcript: string;
    transcriptWordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
  },
): Promise<void> {
  await db
    .update(storyRecordings)
    .set({
      transcript: input.transcript,
      ...(input.transcriptWordTimings
        ? { transcriptWordTimings: input.transcriptWordTimings }
        : {}),
    })
    .where(eq(storyRecordings.id, input.storyRecordingId));
}

/**
 * Drop a FOLLOW-UP take (position > 0) pre-approval, and return its storage key for blob cleanup.
 * Guards: owner-only, story not yet consented (state draft/pending_approval), position != 0
 * (dropping the initial take is the whole-thread discard — use discardDraftStory instead). The
 * DB delete-guard trigger is the backstop; this is the friendly application-level check.
 */
export async function dropStoryRecording(
  db: Database,
  input: { storyId: string; position: number; narratorPersonId: string },
): Promise<{ storageKey: string }> {
  if (input.position === 0) {
    throw new InvariantViolation(
      "Cannot drop take 0 — dropping the initial take discards the thread.",
    );
  }
  return db.transaction(async (tx) => {
    const [story] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!story) throw new InvariantViolation("Story not found.");
    if (story.ownerPersonId !== input.narratorPersonId) {
      throw new InvariantViolation("Not the owner.");
    }
    if (story.state !== "draft" && story.state !== "pending_approval") {
      throw new InvariantViolation("Takes are immutable after approval.");
    }
    const [take] = await tx
      .select({ id: storyRecordings.id, mediaId: storyRecordings.mediaId })
      .from(storyRecordings)
      .where(
        and(
          eq(storyRecordings.storyId, input.storyId),
          eq(storyRecordings.position, input.position),
        ),
      )
      .limit(1);
    if (!take) throw new InvariantViolation("Take not found.");
    const [m] = await tx
      .select({ storageKey: media.storageKey })
      .from(media)
      .where(eq(media.id, take.mediaId))
      .limit(1);
    // Delete this take's prose_revisions FIRST (ADR-0014 Inc 3 slice 7). A follow-up take's
    // appendVoiceTakeContribution writes prose_revisions keyed to its recording; the FK
    // prose_revisions.story_recording_id → story_recordings.id is ON DELETE NO ACTION and
    // prose_revisions is append-only (the BEFORE-UPDATE trigger forbids UPDATE, so the link can't be
    // nulled). We DELETE (not SET NULL) the rows — permitted here because drop is only allowed for
    // draft/pending_approval (no consent_records yet), consistent with ADR-0002's "a discarded draft
    // takes its prose_revisions with it" (a take-drop is a partial discard). We deliberately do NOT
    // touch stories.prose: the narrator's text stays in the working prose and they edit it out
    // manually (RESOLVED DECISION d). FK delete order: prose_revisions (children) → story_recordings
    // → media (the never-consented take blob).
    await tx.delete(proseRevisions).where(eq(proseRevisions.storyRecordingId, take.id));
    await tx.delete(storyRecordings).where(eq(storyRecordings.id, take.id));
    await tx.delete(media).where(eq(media.id, take.mediaId));
    return { storageKey: m!.storageKey };
  });
}

// ---------------------------------------------------------------------------
// Unit 03: Edit story title and tags (owner only, state-agnostic, auditable)
// ---------------------------------------------------------------------------

export interface EditStoryDetailsInput {
  storyId: string;
  actorPersonId: string;
  title: string;
  tags: string[];
}

export async function editStoryDetails(
  db: Database,
  input: EditStoryDetailsInput,
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, prose: stories.prose })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);

    if (!current) {
      throw new InvariantViolation(`story not found: ${input.storyId}`);
    }

    if (current.ownerPersonId !== input.actorPersonId) {
      throw new InvariantViolation(
        `editStoryDetails: actor ${input.actorPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) {
      throw new InvariantViolation("title must be non-empty");
    }

    // Normalize tags: trim, drop empty, dedupe case-sensitively, max 12 tags, max 40 chars per tag.
    const normalizedTags: string[] = [];
    const seenTags = new Set<string>();

    for (const tag of input.tags) {
      const trimmedTag = tag.trim();
      if (!trimmedTag) continue;
      if (trimmedTag.length > 40) {
        throw new InvariantViolation("tag exceeds max length of 40 characters");
      }
      if (!seenTags.has(trimmedTag)) {
        seenTags.add(trimmedTag);
        normalizedTags.push(trimmedTag);
      }
    }

    if (normalizedTags.length > 12) {
      throw new InvariantViolation("story cannot have more than 12 tags");
    }

    const [updatedStory] = await tx
      .update(stories)
      .set({
        title: trimmedTitle,
        tags: normalizedTags,
        updatedAt: new Date(),
      })
      .where(eq(stories.id, input.storyId))
      .returning();

    // Append audit row carrying the current unchanged prose snapshot in text.
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "human_metadata_edit",
      text: current.prose ?? "",
      actorPersonId: input.actorPersonId,
    });

    return updatedStory!;
  });
}

// ---------------------------------------------------------------------------
// Unit 04: Manage family sharing (retargetStoryFamilies)
// ---------------------------------------------------------------------------

export async function retargetStoryFamilies(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; familyIds: string[] },
): Promise<{ targetedFamilyIds: string[] }> {
  if (ctx.kind !== "account") {
    throw new InvariantViolation("retargetStoryFamilies: actor must be an identified account");
  }

  return db.transaction(async (tx) => {
    const [story] = await tx
      .select({ ownerPersonId: stories.ownerPersonId })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);

    if (!story) {
      throw new InvariantViolation(`retargetStoryFamilies: story ${input.storyId} not found`);
    }

    if (ctx.personId !== story.ownerPersonId) {
      throw new InvariantViolation(
        `retargetStoryFamilies: actor ${ctx.personId} is not the owner of story ${input.storyId}`,
      );
    }

    // Get current target families
    const currentTargets = await tx
      .select({ familyId: storyFamilies.familyId })
      .from(storyFamilies)
      .where(eq(storyFamilies.storyId, input.storyId));
    const currentSet = new Set(currentTargets.map((t) => t.familyId));

    const dedupedInput = [...new Set(input.familyIds)].sort();
    const isNoOp =
      dedupedInput.length === currentSet.size &&
      dedupedInput.every((id) => currentSet.has(id));

    const writtenSet = await replaceStoryFamilyTargetsTx(
      tx,
      "retargetStoryFamilies",
      input.storyId,
      story.ownerPersonId,
      input.familyIds,
    );

    if (!isNoOp) {
      // Record consent row on effective sharing scope change
      const serializedFamilyIds = [...writtenSet].sort().join(",");
      await tx.insert(consentRecords).values({
        personId: story.ownerPersonId,
        storyId: input.storyId,
        action: "set_audience_tier",
        resultingState: serializedFamilyIds,
        actorPersonId: ctx.personId,
        approvalAudioMediaId: null,
      });
    }

    return { targetedFamilyIds: writtenSet };
  });
}

// ---------------------------------------------------------------------------
// Unit 05: Edit story prose body (post-share, owner-only, state-agnostic)
// ---------------------------------------------------------------------------

export interface EditStoryProseInput {
  storyId: string;
  prose: string;
  actorPersonId: string;
  expectedUpdatedAt?: string; // Optional optimistic concurrency check
}

export async function editStoryProse(
  db: Database,
  input: EditStoryProseInput,
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state, updatedAt: stories.updatedAt })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);

    if (!current) {
      throw new InvariantViolation(`story not found: ${input.storyId}`);
    }

    if (current.ownerPersonId !== input.actorPersonId) {
      throw new InvariantViolation(
        `editStoryProse: actor ${input.actorPersonId} is not the owner of story ${input.storyId}`,
      );
    }

    // Allowed states: draft, pending_approval, approved, shared
    const allowedStates: StoryState[] = ["draft", "pending_approval", "approved", "shared"];
    if (!allowedStates.includes(current.state)) {
      throw new InvariantViolation(`editStoryProse: story state ${current.state} is not editable`);
    }

    // Optimistic concurrency check
    if (input.expectedUpdatedAt) {
      const clientTime = new Date(input.expectedUpdatedAt).getTime();
      const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0;
      // Allow minor timestamp precision differences (within 1000ms)
      if (Math.abs(serverTime - clientTime) > 1000) {
        throw new InvariantViolation(
          "This story changed since you opened the editor — reload and re-apply.",
        );
      }
    }

    const trimmedProse = input.prose.trim();

    const [updatedStory] = await tx
      .update(stories)
      .set({
        prose: trimmedProse,
        updatedAt: new Date(),
      })
      .where(eq(stories.id, input.storyId))
      .returning();

    // Append audit row using existing human_corrected level, recording the new prose
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "human_corrected",
      text: trimmedProse,
      actorPersonId: input.actorPersonId,
      modelId: null,
      promptText: null,
      storyRecordingId: null,
    });

    return updatedStory!;
  });
}

// ---------------------------------------------------------------------------
// Unit 06: Favorite (private bookmark + count)
// ---------------------------------------------------------------------------

export interface FavoriteState {
  favoritedByViewer: boolean;
  count: number;
}

export async function setStoryFavorite(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; favorited: boolean },
): Promise<FavoriteState> {
  if (ctx.kind !== "account") {
    throw new InvariantViolation("setStoryFavorite: anonymous or link_session cannot favorite a story");
  }

  // Gate on SEE permission via getStoryForViewer
  const story = await getStoryForViewer(db, ctx, input.storyId);
  if (!story) {
    throw new InvariantViolation(`setStoryFavorite: story ${input.storyId} not found or access denied`);
  }

  await db.transaction(async (tx) => {
    if (input.favorited) {
      await tx
        .insert(storyFavorites)
        .values({
          storyId: input.storyId,
          personId: ctx.personId,
        })
        .onConflictDoNothing({
          target: [storyFavorites.storyId, storyFavorites.personId],
        });
    } else {
      await tx
        .delete(storyFavorites)
        .where(
          and(
            eq(storyFavorites.storyId, input.storyId),
            eq(storyFavorites.personId, ctx.personId),
          ),
        );
    }
  });

  return getFavoriteState(db, ctx, input.storyId);
}

export async function getFavoriteState(
  db: Database,
  ctx: AuthContext,
  storyId: string,
): Promise<FavoriteState> {
  // Gate on SEE permission
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story) {
    throw new InvariantViolation(`getFavoriteState: story ${storyId} not found or access denied`);
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storyFavorites)
    .where(eq(storyFavorites.storyId, storyId));

  const favoritedByViewer =
    ctx.kind === "account"
      ? await db
          .select({ id: storyFavorites.id })
          .from(storyFavorites)
          .where(
            and(
              eq(storyFavorites.storyId, storyId),
              eq(storyFavorites.personId, ctx.personId),
            ),
          )
          .limit(1)
          .then((rows) => rows.length > 0)
      : false;

  return {
    favoritedByViewer,
    count: countResult?.count ?? 0,
  };
}

export async function listFavoriteStoriesForViewer(
  db: Database,
  ctx: AuthContext,
): Promise<string[]> {
  if (ctx.kind !== "account") {
    return [];
  }

  const rows = await db
    .select({ storyId: storyFavorites.storyId })
    .from(storyFavorites)
    .where(eq(storyFavorites.personId, ctx.personId))
    .orderBy(desc(storyFavorites.createdAt));

  return rows.map((r) => r.storyId);
}

// ---------------------------------------------------------------------------
// Unit 07: Like (visible reaction + count + leak-safe list)
// ---------------------------------------------------------------------------

export interface LikeState {
  likedByViewer: boolean;
  count: number;
  likers: Array<{ personId: string; displayName: string }>;
}

export async function setStoryLike(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; liked: boolean },
): Promise<LikeState> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) {
    throw new InvariantViolation("setStoryLike: anonymous cannot like a story");
  }

  // Gate on SEE permission
  const story = await getStoryForViewer(db, ctx, input.storyId);
  if (!story) {
    throw new InvariantViolation(`setStoryLike: story ${input.storyId} not found or access denied`);
  }

  await db.transaction(async (tx) => {
    if (input.liked) {
      await tx
        .insert(storyLikes)
        .values({
          storyId: input.storyId,
          personId: viewer,
        })
        .onConflictDoNothing({
          target: [storyLikes.storyId, storyLikes.personId],
        });
    } else {
      await tx
        .delete(storyLikes)
        .where(
          and(
            eq(storyLikes.storyId, input.storyId),
            eq(storyLikes.personId, viewer),
          ),
        );
    }
  });

  return getLikeState(db, ctx, input.storyId);
}

export async function getLikeState(
  db: Database,
  ctx: AuthContext,
  storyId: string,
): Promise<LikeState> {
  // Gate on SEE permission
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story) {
    throw new InvariantViolation(`getLikeState: story ${storyId} not found or access denied`);
  }

  const viewer = viewerPersonId(ctx);

  // Total unfiltered count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storyLikes)
    .where(eq(storyLikes.storyId, storyId));

  const likedByViewer =
    viewer !== null
      ? await db
          .select({ id: storyLikes.id })
          .from(storyLikes)
          .where(
            and(
              eq(storyLikes.storyId, storyId),
              eq(storyLikes.personId, viewer),
            ),
          )
          .limit(1)
          .then((rows) => rows.length > 0)
      : false;

  // Leak-safe likers list
  let likersList: Array<{ personId: string; displayName: string }> = [];
  if (viewer !== null) {
    const viewerActiveFamilies = await db
      .select({ familyId: memberships.familyId })
      .from(memberships)
      .where(and(eq(memberships.personId, viewer), eq(memberships.status, "active")));
    const activeFamilyIds = viewerActiveFamilies.map((f) => f.familyId);

    if (activeFamilyIds.length > 0) {
      const rows = await db
        .select({
          personId: persons.id,
          displayName: persons.displayName,
        })
        .from(storyLikes)
        .innerJoin(persons, eq(persons.id, storyLikes.personId))
        .innerJoin(memberships, eq(memberships.personId, storyLikes.personId))
        .where(
          and(
            eq(storyLikes.storyId, storyId),
            eq(memberships.status, "active"),
            inArray(memberships.familyId, activeFamilyIds),
          ),
        );

      const seen = new Set<string>();
      for (const row of rows) {
        if (!seen.has(row.personId)) {
          seen.add(row.personId);
          likersList.push({ personId: row.personId, displayName: row.displayName });
        }
      }
    }

    // Always include viewer themselves in the list if they liked it
    if (likedByViewer && !likersList.some((l) => l.personId === viewer)) {
      const [selfDetails] = await db
        .select({ personId: persons.id, displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, viewer))
        .limit(1);
      if (selfDetails) {
        likersList.unshift(selfDetails);
      }
    }
  }

  return {
    likedByViewer,
    count: countResult?.count ?? 0,
    likers: likersList,
  };
}
