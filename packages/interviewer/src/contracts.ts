/**
 * Interviewer seams — the contracts every adapter / data source plugs into.
 *
 * The interviewer is the IP: a controlled turn loop. The bought LLM (via `LanguageModel` from
 * `@chronicle/pipeline`) only PHRASES a chosen-topic question; the choice of topic, the
 * sequencing, sensitivity gating, off-ramp recognition, and cross-session memory are all in
 * our code. The `Voice` seam below is the interviewer's synthetic TTS for SPEAKING the
 * question — entirely distinct from the narrator's preserved original recordings, which the
 * capture path persists immutably and which are never synthesized.
 *
 * Vendor SDKs live ONLY in adapter files (none ship in Phase 1; ElevenLabs is the prod default
 * per DECISIONS). The architecture test in `packages/pipeline/test/pipeline.test.ts` scans this
 * package for vendor-SDK imports and fails CI if any leak in.
 */

import type { BiographicalProfile, FollowUpCandidate } from "@chronicle/db";
import type { LifeEventAnchor, StoryDateOccurrence } from "@chronicle/core";

export type { BiographicalProfile };

// ---------------------------------------------------------------------------
// Voice — TTS for the interviewer's questions ONLY.
// The chosen voice identity (persona) is configuration; the same warm voice every session is
// a dignity requirement (spec Part III). The Voice seam returns audio bytes; the higher-level
// turn loop hands those to the narrator surface for playback.
// ---------------------------------------------------------------------------

export interface VoiceSpeakInput {
  text: string;
  /**
   * Optional persona identifier. Phase 1: the consumer passes a single configured voice id; the
   * seam stays neutral so we can A/B personas later without a contract change.
   */
  voiceId?: string;
}

export interface VoiceSpeakResult {
  bytes: Uint8Array;
  contentType: string;
  /** Best-effort duration of the synthesized speech, for the turn-loop's pacing decisions. */
  durationMs: number;
  /** Vendor model identifier (recorded so a regeneration can compare). */
  modelId: string;
}

export interface Voice {
  speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult>;
}

// ---------------------------------------------------------------------------
// AskSource — the relay seam. I7 plugs the real DB-backed Ask reader in here; Phase 1 needs
// only the seam shape so the turn loop can prioritize Asks above the base bank, and the
// "asker named" framing is a first-class concept rather than a string the I7 agent has to
// retro-fit.
//
// NOTE: this stays a contract here on purpose — pulling from the asks table is a non-content
// read but routing it through the interviewer's seam (rather than a direct DB call) keeps
// future moves (priority by relationship, asker reputation, multi-family routing) inside the
// interviewer's behavior policy where it belongs.
// ---------------------------------------------------------------------------

export interface PendingAsk {
  askId: string;
  /** The asker's spoken/display name — used by the warm "Sofia was wondering…" framing. */
  askerName: string;
  questionText: string;
  /**
   * The published Story this ask is a FOLLOW-UP on (#77), or null for a cold ask. Lets the turn
   * loop frame the question with its origin ("about the story you told, Sofia was wondering…") and
   * lets the session deep-link back to the source. It is only the story ID — the interviewer already
   * has audited access to the narrator's own story metadata via the `MemorySource` if it needs a title.
   */
  sourceStoryId?: string | null;
  /**
   * Priority hint (higher = sooner). The turn loop sorts by this then by FIFO, so a future
   * adapter can boost (e.g. a recent ask from a young grandchild) without UI changes.
   */
  priority?: number;
}

export interface AskSource {
  /** Pending Asks targeting this narrator, in arrival order (the loop will re-sort by priority). */
  pendingForNarrator(personId: string): Promise<PendingAsk[]>;
  /**
   * Notify the source that an Ask has been consumed into a turn (queued → routed). The DB
   * adapter flips the Ask's status; the in-memory mock no-ops. Called by the turn loop after a
   * successful `ask` intent so the asker-side notification view stops showing it as `queued`.
   */
  markRouted(askId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// MemorySource — cross-session memory: what THIS narrator has already talked about. The loop
// uses this for (a) the warm callback that opens a returning session ("Last week you started
// telling me about the farm…") and (b) de-duplication so the base bank doesn't ask the same
// thing twice.
//
// Phase 1's prod impl is the audited core read `listNarratorMemoryForInterviewer`. Returning ONLY
// title/summary/tags (no transcript, no audio bytes) keeps the interviewer surface from
// becoming a backdoor on story content — those fields are derived, regenerable, and already
// the lowest-sensitivity story metadata. The tests use an in-memory mock.
// ---------------------------------------------------------------------------

export interface PriorStoryMemory {
  storyId: string;
  /** Title is short and faithful (the renderer constrains it). May be null for very young drafts. */
  title: string | null;
  summary: string | null;
  tags: string[];
  /** What prompted the prior telling — lets the loop avoid re-asking the same base question. */
  promptQuestion: string | null;
  createdAt: Date;
}

export interface MemorySource {
  recentStoriesForNarrator(personId: string, limit: number): Promise<PriorStoryMemory[]>;
}

// ---------------------------------------------------------------------------
// BiographicalAnchors — lightly-held facts the interviewer may use to "arrive prepared." The
// `profile` carries typed biographical context (names, background, and life context such as
// occupation, sibling context, current location, and whether they have children/grandchildren).
// Load-bearing rule: these set NAMES and TONE only — the interviewer must never state any of
// them as fact unless the narrator confirms it.
// ---------------------------------------------------------------------------

export interface BiographicalAnchors {
  personId: string;
  spokenName: string;
  birthYear: number | null;
  /**
   * Full birth date (ISO YYYY-MM-DD) when known — the primary anchor the Story date resolver
   * derives age/grade references against (ADR-0026). Null = unknown (derivation degrades to
   * stated dates only).
   */
  birthDate: string | null;
  /**
   * The narrator's known Life events (wedding, graduation, …), pared to kind + ISO date — the
   * reusable anchors for relative references ("about ten years after we married"). Loaded once
   * per session with the rest of the anchors inflow.
   */
  lifeEvents: LifeEventAnchor[];
  /**
   * Named biographical facts from `persons.biographical_anchors` jsonb — collected by the
   * ephemeral intake pass and inferred from approved stories (e.g. hometown, sibling context).
   * Each field is nullable (null = "not yet known"). Treated as hints, never as ground truth —
   * the rendered prompt notes "as far as we know."
   */
  profile: BiographicalProfile;
}

export interface AnchorSource {
  loadForNarrator(personId: string): Promise<BiographicalAnchors | null>;
  /**
   * Write a single biographical profile field. Called by the turn loop after an intake answer is
   * extracted, and by the post-approval pipeline step. Never call with null — null means "unknown",
   * and we never downgrade a known field back to unknown.
   */
  writeProfileField<K extends keyof BiographicalProfile>(
    personId: string,
    key: K,
    value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// StoryDateSink — the persistence side of live date derivation (ADR-0026). As each take arrives,
// the turn loop runs the pure `resolveStoryDate` over the story text so far; a resolved
// occurrence is handed to this seam, which persists it (with its user-visible provenance note)
// through the story repository's `updateDerivedFields` write seam. The loop stays DB-free: prod
// plugs `createCoreStoryDateSink(db)`; tests use the in-memory mock. An UNRESOLVABLE telling
// produces no call — and no question (the temporal follow-up is a separate ticket).
// ---------------------------------------------------------------------------

export interface PersistResolvedStoryDateInput {
  /** The draft Story this session's tellings are contributing to. */
  storyId: string;
  /** The resolver's output — form, point/span, and the plain-language provenance note. */
  occurrence: StoryDateOccurrence;
}

export interface StoryDateSink {
  persistResolvedStoryDate(input: PersistResolvedStoryDateInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// FollowUpEvaluator — the propose side of propose-then-dispose (ADR-0013). The bought LLM reads a
// take's transcript + light context and PROPOSES ranked tagged candidate threads. It decides
// NOTHING about the loop: our code (decideFollowUp in behavior.ts) applies the caps, the rapport
// gate, the distress short-circuit, the anti-repeat, and the emotional-door veto over these tags.
// Vendor SDKs live only in adapters — the architecture test scans this package and fails CI on any
// SDK import here. Phase 1 ships the mock (ScriptedFollowUpEvaluator); prod plugs Anthropic in.
// ---------------------------------------------------------------------------

export type { FollowUpCandidate };

export interface FollowUpEvaluationInput {
  /** Transcript of the take just recorded (the evaluator's primary input). */
  answerTranscript: string;
  /** The prompt this answer responded to (the Ask question, or the prior follow-up line). */
  promptText: string;
  /** Thread seeds already pursued this sitting — the model must propose only NOVEL threads. */
  alreadyAskedSeeds: ReadonlyArray<string>;
  /** Categories the narrator has already covered (novelty hint for the model). */
  coveredCategories: ReadonlyArray<string>;
  /** Follow-ups already asked in THIS thread (context only; code enforces the cap). */
  followUpsAskedInThread: number;
  /** True once the rapport threshold is met — a hint the model may weigh sensitivity against. */
  rapportEstablished: boolean;
}

export interface FollowUpEvaluation {
  /** Candidates (the model may rank; code re-ranks by confidence + tie-break authoritatively). */
  candidates: FollowUpCandidate[];
  /** Vendor model id, recorded in the decision record for replay/provenance. */
  modelId: string;
}

export interface FollowUpEvaluator {
  evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation>;
}
