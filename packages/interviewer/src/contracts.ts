/**
 * Interviewer seams — the contracts every adapter / data source plugs into.
 *
 * The interviewer is the IP: a controlled turn loop. The bought LLM (via `LanguageModel` from
 * `@chronicle/pipeline`) only PHRASES a chosen-topic question; the choice of topic, the
 * sequencing, sensitivity gating, off-ramp recognition, and cross-session memory are all in
 * our code. The `Voice` seam below is the interviewer's synthetic TTS for SPEAKING the
 * question — entirely distinct from the elder's preserved original recordings, which the
 * capture path persists immutably and which are never synthesized.
 *
 * Vendor SDKs live ONLY in adapter files (none ship in Phase 1; ElevenLabs is the prod default
 * per DECISIONS). The architecture test in `packages/pipeline/test/pipeline.test.ts` scans this
 * package for vendor-SDK imports and fails CI if any leak in.
 */

// ---------------------------------------------------------------------------
// Voice — TTS for the interviewer's questions ONLY.
// The chosen voice identity (persona) is configuration; the same warm voice every session is
// a dignity requirement (spec Part III). The Voice seam returns audio bytes; the higher-level
// turn loop hands those to the elder surface for playback.
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
   * Priority hint (higher = sooner). The turn loop sorts by this then by FIFO, so a future
   * adapter can boost (e.g. a recent ask from a young grandchild) without UI changes.
   */
  priority?: number;
}

export interface AskSource {
  /** Pending Asks targeting this elder, in arrival order (the loop will re-sort by priority). */
  pendingForElder(personId: string): Promise<PendingAsk[]>;
}

// ---------------------------------------------------------------------------
// MemorySource — cross-session memory: what THIS elder has already talked about. The loop
// uses this for (a) the warm callback that opens a returning session ("Last week you started
// telling me about the farm…") and (b) de-duplication so the base bank doesn't ask the same
// thing twice.
//
// Phase 1's prod impl is the audited core read `listElderMemoryForInterviewer`. Returning ONLY
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
  recentStoriesForElder(personId: string, limit: number): Promise<PriorStoryMemory[]>;
}

// ---------------------------------------------------------------------------
// BiographicalAnchors — lightly-held facts the interviewer may use to "arrive prepared." The
// spec is explicit: these set NAMES and TONE; the interviewer must never invent facts from them.
// ---------------------------------------------------------------------------

export interface BiographicalAnchors {
  personId: string;
  spokenName: string;
  birthYear: number | null;
  /**
   * Free-form anchors from `persons.biographical_anchors` jsonb (e.g. birthplace, profession).
   * Treated as hints, never as ground truth — the rendered prompt notes "as far as we know."
   */
  anchors: Record<string, unknown>;
}

export interface AnchorSource {
  loadForElder(personId: string): Promise<BiographicalAnchors | null>;
}
