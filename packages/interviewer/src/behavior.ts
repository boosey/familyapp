/**
 * Behavior policy — the IP. Pure functions that decide what the interviewer SHOULD do, given
 * the conversation state so far. The turn loop in `turn-loop.ts` wires these into a runnable
 * loop; this file holds the rules so they are inspectable, testable, and don't drift into
 * the prompt string the LLM sees.
 *
 * The spec's behavioral commitments, made executable:
 *   - Open-ended/concrete/non-leading       — enforced by drafting rules in `questions/bank.ts`.
 *   - One question at a time                — `pickNextIntent` returns exactly one Intent.
 *   - Silence-tolerant                      — `SILENCE_TOLERANCE_MS` is generous; pacing lives
 *                                             with the surface, but the policy is named here.
 *   - Reflect/follow tangents               — `pickNextIntent` returns a "follow_up" Intent when
 *                                             the last narrator utterance carried a recognized
 *                                             thread (a noun or name we'd like to dig into).
 *   - Gentle sequencing                     — `pickNextIntent` will not pick a `high`-sensitivity
 *                                             question until `RAPPORT_THRESHOLD_TURNS` warm
 *                                             exchanges have completed and the narrator has not
 *                                             signalled distress.
 *   - Never push into pain                  — if `detectDistress` or `detectOffRamp` flips,
 *                                             `pickNextIntent` returns a redirect/wind-down,
 *                                             and the system prompt the LLM phraser sees adds
 *                                             a human-support note.
 *   - Reminiscence-bump weighting           — base-bank picking prefers `REMINISCENCE_BUMP_PHASES`.
 *   - Cross-session warm callback           — on the first turn of a session AND with prior
 *                                             stories present, the picker returns a `callback`
 *                                             Intent before anything else.
 */
import type { PendingAsk, PriorStoryMemory } from "./contracts";
import {
  QUESTION_BANK,
  REMINISCENCE_BUMP_PHASES,
  type BaseQuestion,
  type Sensitivity,
} from "./questions/bank";
// Policy constants (RAPPORT_THRESHOLD_TURNS, SILENCE_TOLERANCE_MS, MEMORY_LOOKBACK_COUNT, …) now
// live in ./constants — single source of truth so a reviewer can audit them in one place.
import { RAPPORT_THRESHOLD_TURNS } from "./constants";

// ---------------------------------------------------------------------------
// Session state — accumulated as turns happen. Pure data, owned by the caller; the picker is
// stateless and receives this each call.
// ---------------------------------------------------------------------------

export interface SessionState {
  /** Person id of the narrator this session belongs to. */
  narratorPersonId: string;
  /** Number of completed turns in the CURRENT session (resets across sessions). */
  turnCount: number;
  /** Set of base-question ids the interviewer has used this session — never re-picked. */
  askedQuestionIds: Set<string>;
  /** Set of Ask ids the interviewer has consumed this session. */
  consumedAskIds: Set<string>;
  /** Categories the narrator has already covered (from prior stories' tags + this session). */
  coveredCategories: Set<string>;
  /** The most recent narrator utterance, if any — used to surface a "follow_up" Intent. */
  lastNarratorUtterance: string | null;
  /** True if distress was detected — the policy avoids any further sensitive topics. */
  distressed: boolean;
  /** True if the narrator has explicitly asked to skip / change topic / wind down. */
  offRampRequested: boolean;
}

export function createSessionState(narratorPersonId: string): SessionState {
  return {
    narratorPersonId,
    turnCount: 0,
    askedQuestionIds: new Set(),
    consumedAskIds: new Set(),
    coveredCategories: new Set(),
    lastNarratorUtterance: null,
    distressed: false,
    offRampRequested: false,
  };
}

// ---------------------------------------------------------------------------
// The Intent — the structured decision the picker returns. The LLM phraser turns this into
// spoken English; nothing else in the policy depends on the wording.
// ---------------------------------------------------------------------------

export type PromptIntent =
  | {
      kind: "callback";
      /** The prior story the warm callback refers to. */
      priorStoryId: string;
      priorTitle: string | null;
      priorSummary: string | null;
    }
  | {
      kind: "ask";
      askId: string;
      askerName: string;
      questionText: string;
    }
  | {
      kind: "follow_up";
      /** A short paraphrase / topic seed of the thread to dig into. */
      threadSeed: string;
    }
  | {
      kind: "base";
      question: BaseQuestion;
    }
  | {
      kind: "wind_down";
      reason: "off_ramp" | "distress" | "fatigue";
      /** True iff the policy wants the phraser to surface human-support availability. */
      surfaceHumanSupport: boolean;
    };

// ---------------------------------------------------------------------------
// Listener-side: detect distress and off-ramp from the narrator's utterance. Conservative
// heuristics — the cost of a missed detection is over-asking on a sensitive topic, so the
// heuristics deliberately err on the side of pulling back.
// ---------------------------------------------------------------------------

/**
 * Distress lexicon — short, conservative. Real production would A/B richer signals (prosody,
 * crying, latency), but the spec is explicit that the policy NEVER pushes into pain, so a
 * naive lexicon already pays for itself.
 */
const DISTRESS_PHRASES = [
  "i can't talk about",
  "i don't want to talk about",
  "it hurts to think about",
  "this is too painful",
  "i'm crying",
  "i can't",
  "please stop",
];

/**
 * Off-ramp lexicon — the narrator asking, in plain speech, to change direction. Spec calls these
 * out as spoken off-ramps the interviewer must honor immediately.
 */
const OFF_RAMP_PHRASES = [
  "let's skip that",
  "skip that",
  "let's talk about something happier",
  "change the subject",
  "let's move on",
  "that's enough for today",
  "i'm tired",
  "i'm done",
  "no more questions",
];

function containsAny(text: string, phrases: ReadonlyArray<string>): boolean {
  const t = text.toLowerCase();
  return phrases.some((p) => t.includes(p));
}

export function detectDistress(utterance: string): boolean {
  return containsAny(utterance, DISTRESS_PHRASES);
}

export function detectOffRamp(utterance: string): boolean {
  return containsAny(utterance, OFF_RAMP_PHRASES);
}

/** Apply the narrator's latest utterance to the session state. Returns the same state for chaining. */
export function ingestNarratorUtterance(state: SessionState, utterance: string): SessionState {
  state.lastNarratorUtterance = utterance;
  if (detectDistress(utterance)) state.distressed = true;
  if (detectOffRamp(utterance)) state.offRampRequested = true;
  return state;
}

// ---------------------------------------------------------------------------
// The picker — the one function the turn loop calls each turn. Pure: given inputs, returns
// the next Intent. Order of preference:
//   0. wind_down if off-ramp or distress
//   1. warm callback on turn 0 if prior stories exist
//   2. pending Asks (highest priority first)
//   3. follow_up if the last utterance carried something worth digging into
//   4. base bank, reminiscence-bump preferred, sensitivity-gated
// ---------------------------------------------------------------------------

export interface PickInput {
  state: SessionState;
  pendingAsks: ReadonlyArray<PendingAsk>;
  priorStories: ReadonlyArray<PriorStoryMemory>;
}

export function pickNextIntent(input: PickInput): PromptIntent {
  const { state, pendingAsks, priorStories } = input;

  // 0. Honor an off-ramp / distress signal immediately. The phraser will surface human-support
  // availability when distress was detected (the spec note about "this is not therapy, human
  // support exists" — surfaced by the LLM in plain warm speech).
  if (state.distressed) {
    return { kind: "wind_down", reason: "distress", surfaceHumanSupport: true };
  }
  if (state.offRampRequested) {
    return { kind: "wind_down", reason: "off_ramp", surfaceHumanSupport: false };
  }

  // 1. Warm callback on turn 0 IF there are prior stories. Continuity feels like a relationship.
  if (state.turnCount === 0 && priorStories.length > 0) {
    const recent = priorStories[0]!;
    return {
      kind: "callback",
      priorStoryId: recent.storyId,
      priorTitle: recent.title,
      priorSummary: recent.summary,
    };
  }

  // 2. Pending Asks — sorted by priority (desc), filtered to ones we haven't used this session.
  const fresh = pendingAsks.filter((a) => !state.consumedAskIds.has(a.askId));
  if (fresh.length > 0) {
    const sorted = fresh
      .slice()
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const top = sorted[0]!;
    return {
      kind: "ask",
      askId: top.askId,
      askerName: top.askerName,
      questionText: top.questionText,
    };
  }

  // 3. Follow_up — if the last narrator utterance was substantial, prefer reflecting on it. The
  // policy here is conservative: only if the utterance is long enough to imply a real thread.
  // The LLM does the actual semantic work of identifying the thread in the system prompt.
  const last = state.lastNarratorUtterance;
  if (last && last.trim().split(/\s+/).length >= 12) {
    return { kind: "follow_up", threadSeed: last };
  }

  // 4. Base bank. De-dup against already-asked AND categories the narrator has covered. Then
  // gate by sensitivity (no `high` until rapport threshold). Among survivors prefer
  // reminiscence-bump phases.
  const eligible = QUESTION_BANK.filter((q) => {
    if (state.askedQuestionIds.has(q.id)) return false;
    if (state.coveredCategories.has(q.category)) return false;
    if (!sensitivityAllowed(q.sensitivity, state)) return false;
    return true;
  });

  if (eligible.length === 0) {
    // Spec: never push. Fall through to a gentle wind-down.
    return { kind: "wind_down", reason: "fatigue", surfaceHumanSupport: false };
  }

  const preferred = eligible.filter((q) => REMINISCENCE_BUMP_PHASES.has(q.lifePhase));
  const pool = preferred.length > 0 ? preferred : eligible;
  // Deterministic pick: first eligible by bank order. Production may swap in a small PRNG
  // keyed by session id; the picker contract is just "return SOME eligible question".
  return { kind: "base", question: pool[0]! };
}

function sensitivityAllowed(s: Sensitivity, state: SessionState): boolean {
  if (s !== "high") return true;
  return state.turnCount >= RAPPORT_THRESHOLD_TURNS && !state.distressed;
}

/**
 * After a turn completes, mark it in the session state. Centralized so the turn loop and tests
 * agree on what "completed" means.
 */
export function recordTurnCompleted(state: SessionState, intent: PromptIntent): void {
  state.turnCount += 1;
  switch (intent.kind) {
    case "base":
      state.askedQuestionIds.add(intent.question.id);
      state.coveredCategories.add(intent.question.category);
      break;
    case "ask":
      state.consumedAskIds.add(intent.askId);
      break;
    case "follow_up":
      // The thread has been consumed. Clearing prevents the picker from re-emitting follow_up
      // on the same utterance every subsequent turn until the narrator speaks again — without
      // this, one substantial answer would steer the loop indefinitely.
      state.lastNarratorUtterance = null;
      break;
    case "callback":
    case "wind_down":
      // No bookkeeping beyond the turn count.
      break;
  }
}

/**
 * Prime `coveredCategories` from the narrator's prior stories' tags, so the picker doesn't ask
 * something the narrator has already covered in a different session. The match is by category
 * name appearing in the tag list — Phase 1's prose tagger emits free-form tags, so this is a
 * best-effort overlap; over time the tagger and the category enum can converge.
 */
export function primeCoveredCategoriesFromPrior(
  state: SessionState,
  priorStories: ReadonlyArray<PriorStoryMemory>,
): void {
  for (const story of priorStories) {
    for (const tag of story.tags) {
      // Lowercase exact match against the category enum — robust and auditable.
      state.coveredCategories.add(tag.toLowerCase());
    }
  }
}
