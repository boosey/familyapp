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
import {
  asks,
  consentRecords,
  memberships,
  persons,
  storyFamilies,
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
  /**
   * The family the recording was captured for (the link-session's family). Recorded on the story
   * as its originating context so approval can DEFAULT-target it into that family (ADR-0010).
   * Absent for the in-hub account capture path, which carries no session family.
   */
  originatingFamilyId?: string;
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
        originatingFamilyId: draft.originatingFamilyId ?? null,
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
  askFamilyId: string | null;
  ownerActiveFamilyIds: Set<string>;
}): { targets: string[]; ambiguous: boolean } {
  const { originatingFamilyId, askFamilyId, ownerActiveFamilyIds } = args;
  const originating = [...new Set([originatingFamilyId, askFamilyId])].filter(
    (f): f is string => f !== null && ownerActiveFamilyIds.has(f),
  );
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
    // The ask's family (if any) is a secondary originating signal for default targeting (step 6).
    let askFamilyId: string | null = null;
    if (current.askId !== null) {
      const [askCurrent] = await tx
        .select({
          status: asks.status,
          storyId: asks.storyId,
          familyId: asks.familyId,
        })
        .from(asks)
        .where(eq(asks.id, current.askId))
        .limit(1);
      if (!askCurrent) {
        throw new InvariantViolation(
          `story ${input.storyId} references missing ask ${current.askId}`,
        );
      }
      askFamilyId = askCurrent.familyId;
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
      const existing = await tx
        .select({ familyId: storyFamilies.familyId })
        .from(storyFamilies)
        .where(eq(storyFamilies.storyId, input.storyId))
        .orderBy(storyFamilies.familyId);
      if (existing.length > 0) {
        // Sorted above so the returned set is deterministic regardless of row insertion order.
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
          askFamilyId,
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
        eq(stories.state, "pending_approval"),
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

    // 6. Delete the story's `story_families` targeting rows FIRST. Those rows reference the story
    //    (child → parent) with an `ON DELETE no action` FK, so deleting the story while any target
    //    row exists raises an FK violation. A draft/pending story CAN have target rows: the
    //    pre-approval targeting primitives (`setStoryFamilyTargets`) let a narrator pick families
    //    before approving. Clear them here (no consent implication — targeting is not content).
    await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, input.storyId));

    // 7. Then delete in STORY-FIRST order (see JSDoc above for the FK + trigger rationale): the
    //    story references the media (story is the CHILD of media there), so the story goes first.
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
export async function setStoryFamilyTargets(
  db: Database,
  storyId: string,
  familyIds: string[],
): Promise<void> {
  const unique = [...new Set(familyIds)];
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

    if (unique.length > 0) {
      // The families the owner is an ACTIVE member of — the only families a story may target.
      const ownerActive = await tx
        .select({ familyId: memberships.familyId })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, story.ownerPersonId),
            eq(memberships.status, "active"),
          ),
        );
      const ownerActiveSet = new Set(ownerActive.map((r) => r.familyId));
      for (const familyId of unique) {
        if (!ownerActiveSet.has(familyId)) {
          throw new InvariantViolation(
            `setStoryFamilyTargets: story owner ${story.ownerPersonId} is not an active member of ` +
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
