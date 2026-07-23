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
 *                                             Intent (overridden only by a deeplink Ask or a
 *                                             wind-down signal).
 *   - Ephemeral intake pass                 — after callback, the picker asks the next null
 *                                             `BiographicalProfile` field (when anchors are
 *                                             present), so the interviewer "arrives prepared"
 *                                             before open-ended reminiscence.
 */
import type { BiographicalProfile } from "@chronicle/db";
import type {
  CandidateDisposition,
  FollowUpDispositionReason,
  FollowUpPolicy,
  FollowUpType,
} from "@chronicle/db";
import { toAnswerExcerpt } from "./answer-excerpt";
import type { BiographicalAnchors, PendingAsk, PriorStoryMemory } from "./contracts";
import type { FollowUpCandidate, FollowUpEvaluation } from "./contracts";
import type { GapKind } from "./gap-detection";
import {
  QUESTION_BANK,
  REMINISCENCE_BUMP_PHASES,
  type BaseQuestion,
  type Sensitivity,
} from "./questions/bank";
import { nextIntakeQuestion } from "./questions/intake";
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
  /** Intake keys asked this session — prevents re-asking even while the profile field is still null. */
  askedIntakeKeys: Set<keyof BiographicalProfile>;
  /** Categories the narrator has already covered (from prior stories' tags + this session). */
  coveredCategories: Set<string>;
  /** The most recent narrator utterance, if any — used to surface a "follow_up" Intent. */
  lastNarratorUtterance: string | null;
  /** True if distress was detected — the policy avoids any further sensitive topics. */
  distressed: boolean;
  /** True if the narrator has explicitly asked to skip / change topic / wind down. */
  offRampRequested: boolean;
  // --- Gap-driven follow-up (issue #80) ---
  /**
   * A follow-up that has ALREADY passed `decideFollowUp`'s gates and is queued to be surfaced
   * at the next `follow_up` slot. Set by the turn loop's `recordResponse` (after the propose
   * cascade), consumed + cleared when the picker emits it. `null` = nothing pending.
   * `origin` + `gapKind` shade phrasing (`system` = deterministic probe, `gap` = gap detection).
   */
  pendingGapFollowUp: {
    candidate: FollowUpCandidate;
    gapKind: GapKind;
    origin: "system" | "gap";
  } | null;
  /** Gap seeds already asked this session — the anti-repeat backstop fed to `decideFollowUp`. */
  askedGapSeeds: string[];
  /** How many gap follow-ups have been asked this session — feeds the per-session cap. */
  gapFollowUpsAskedInSession: number;
}

export function createSessionState(narratorPersonId: string): SessionState {
  return {
    narratorPersonId,
    turnCount: 0,
    askedQuestionIds: new Set(),
    consumedAskIds: new Set(),
    askedIntakeKeys: new Set(),
    coveredCategories: new Set(),
    lastNarratorUtterance: null,
    distressed: false,
    offRampRequested: false,
    pendingGapFollowUp: null,
    askedGapSeeds: [],
    gapFollowUpsAskedInSession: 0,
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
      kind: "intake";
      /** The biographical profile field this intake turn aims to populate. */
      questionKey: keyof BiographicalProfile;
      questionText: string;
      extractionHint: string;
    }
  | {
      kind: "follow_up";
      /** A short paraphrase / topic seed of the thread to dig into. */
      threadSeed: string;
      /**
       * What produced this follow-up (issue #80 / ADR-0013 cascade). `reflection` = deepen /
       * whole-answer reflect. `gap` = gap-detection named a missing fact. `system` = deterministic
       * probe (e.g. temporal dating). All ride the SAME priority slot and one-question phrasing —
       * the origin only shades how the phraser frames the ask. Defaults to `reflection` when omitted.
       */
      origin?: "reflection" | "gap" | "system";
      /**
       * Category / probe angle for `origin: "gap" | "system"` — lets the phraser target it
       * (e.g. temporal dating guidance).
       */
      gapKind?: GapKind;
      /**
       * A short (1-2 sentence) excerpt of the narrator's OWN words for THIS story, so the phraser
       * grounds the question in what they actually said instead of confabulating from anchors. Set
       * for system/gap probes whose seed is contentless (e.g. the temporal dating seed).
       */
      answerExcerpt?: string;
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
  // State hygiene: once distress/off-ramp latches (these flags are never reset within a session),
  // any gap follow-up queued on an EARLIER turn is permanently unreachable — slot 0 of the picker
  // always wins from here on. Drop it so `getState()` never reports a queued follow-up that will
  // never be asked (an auditor/observability consumer would otherwise see dangling dead data).
  if (state.distressed || state.offRampRequested) state.pendingGapFollowUp = null;
  return state;
}

// ---------------------------------------------------------------------------
// The picker — the one function the turn loop calls each turn. Pure: given inputs, returns
// the next Intent. Order of preference:
//   0. wind_down if off-ramp or distress
//   1. deeplink Ask — a specific askId requested via a notification (jumps the queue)
//   2. warm callback on turn 0 if prior stories exist
//   3. intake — next unanswered biographical field (only when we have an anchors record)
//   4. pending Asks (highest priority first)
//   5. follow_up if the last utterance carried something worth digging into
//   6. base bank, reminiscence-bump preferred, sensitivity-gated
// ---------------------------------------------------------------------------

export interface PickInput {
  state: SessionState;
  pendingAsks: ReadonlyArray<PendingAsk>;
  priorStories: ReadonlyArray<PriorStoryMemory>;
  anchors: BiographicalAnchors | null;
  /** An askId the narrator arrived to answer (e.g. tapped a notification) — served first. */
  targetAskId?: string;
}

export function pickNextIntent(input: PickInput): PromptIntent {
  const { state, pendingAsks, priorStories, anchors, targetAskId } = input;

  // 0. Honor an off-ramp / distress signal immediately. The phraser will surface human-support
  // availability when distress was detected (the spec note about "this is not therapy, human
  // support exists" — surfaced by the LLM in plain warm speech).
  if (state.distressed) {
    return { kind: "wind_down", reason: "distress", surfaceHumanSupport: true };
  }
  if (state.offRampRequested) {
    return { kind: "wind_down", reason: "off_ramp", surfaceHumanSupport: false };
  }

  // 1. Deeplink Ask — a specific askId requested via notification. Served before callback and
  // intake so a narrator who arrives to answer a relative's question is not detoured. Skipped if
  // already consumed this session, and falls through if the id doesn't match a pending Ask.
  if (targetAskId && !state.consumedAskIds.has(targetAskId)) {
    const ask = pendingAsks.find((a) => a.askId === targetAskId);
    if (ask) {
      return { kind: "ask", askId: ask.askId, askerName: ask.askerName, questionText: ask.questionText };
    }
  }

  // 2. Warm callback on turn 0 IF there are prior stories. Continuity feels like a relationship.
  if (state.turnCount === 0 && priorStories.length > 0) {
    const recent = priorStories[0]!;
    return {
      kind: "callback",
      priorStoryId: recent.storyId,
      priorTitle: recent.title,
      priorSummary: recent.summary,
    };
  }

  // 3. Intake — the next unanswered biographical field, but only when we have an anchors record to
  // populate. Ephemeral profile-building precedes the general bank so the interviewer "arrives
  // prepared" before wandering into open-ended reminiscence.
  if (anchors) {
    const q = nextIntakeQuestion(anchors.profile, state.askedIntakeKeys);
    if (q) {
      return { kind: "intake", questionKey: q.key, questionText: q.text, extractionHint: q.extractionHint };
    }
  }

  // 4. Pending Asks — sorted by priority (desc), filtered to ones we haven't used this session.
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

  // 5. Follow_up. Queued cascade winner OR reflection — SAME priority slot + one-question phrasing:
  //   5a. A system/gap follow-up the turn loop already ran through `decideFollowUp` and queued.
  //       Preferred over whole-answer reflection because it targets a specific missing fact.
  //       Safety note: slots 0 above already returned wind_down on distress/off-ramp, so a queued
  //       follow-up can never surface once the narrator has pulled back.
  //   5b. Otherwise the original reflection: if the last utterance was substantial, reflect on it.
  if (state.pendingGapFollowUp) {
    const { candidate, gapKind, origin } = state.pendingGapFollowUp;
    // Ground the phrasing in the narrator's OWN words for THIS turn. System/gap seeds are often
    // contentless (e.g. the temporal dating seed "about when this happened"); without a real
    // referent the phraser confabulates a subject from background anchors. `lastNarratorUtterance`
    // is the answer that triggered this queued follow-up (set by `ingestNarratorUtterance`).
    const excerpt = state.lastNarratorUtterance
      ? toAnswerExcerpt(state.lastNarratorUtterance)
      : "";
    return {
      kind: "follow_up",
      threadSeed: candidate.threadSeed,
      origin,
      gapKind,
      ...(excerpt ? { answerExcerpt: excerpt } : {}),
    };
  }
  const last = state.lastNarratorUtterance;
  if (last && last.trim().split(/\s+/).length >= 12) {
    return { kind: "follow_up", threadSeed: last, origin: "reflection" };
  }

  // 6. Base bank. De-dup against already-asked AND categories the narrator has covered. Then
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
    case "intake":
      state.askedIntakeKeys.add(intent.questionKey);
      break;
    case "follow_up":
      // The thread has been consumed. Clearing prevents the picker from re-emitting follow_up
      // on the same utterance every subsequent turn until the narrator speaks again — without
      // this, one substantial answer would steer the loop indefinitely.
      state.lastNarratorUtterance = null;
      if (intent.origin === "gap" || intent.origin === "system") {
        // Cascade follow-up asked: record its seed (anti-repeat backstop), count it against the
        // session cap, and clear the queue so the picker doesn't re-emit it next turn.
        state.askedGapSeeds.push(intent.threadSeed);
        state.gapFollowUpsAskedInSession += 1;
      }
      // A queued follow-up is consumed whether we asked it or a reflection preempted the
      // slot — either way it must not linger into the next turn on a stale utterance.
      state.pendingGapFollowUp = null;
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

// ---------------------------------------------------------------------------
// decideFollowUp — the DISPOSE half of propose-then-dispose (ADR-0013). The evaluator proposed
// candidates + tags; this pure function applies the code-owned gates and picks at most one,
// emitting a disposition for EVERY candidate (nothing dropped without a recorded reason). The
// caller (recordAnswerAction's mini-loop) persists the returned dispositions into the ledger.
// ---------------------------------------------------------------------------

export interface FollowUpDecisionInput {
  evaluation: FollowUpEvaluation;
  policy: FollowUpPolicy;
  /** Word count of the answer that was evaluated (thin-answer gate). */
  answerWordCount: number;
  followUpsAskedInThread: number;
  followUpsAskedInSession: number;
  distressed: boolean;
  offRampRequested: boolean;
  rapportEstablished: boolean;
  /** Seeds already asked this sitting — the cheap lexical anti-repeat backstop. */
  alreadyAskedSeeds: ReadonlyArray<string>;
}

/** A thread-level veto that applies before any per-candidate ranking. */
export type FollowUpShortCircuit = Extract<
  FollowUpDispositionReason,
  "thin_answer" | "distress_shortcircuit" | "over_cap_thread" | "over_cap_session"
>;

export interface FollowUpDecision {
  /** The chosen candidate to phrase, or null → the thread ends. */
  selected: FollowUpCandidate | null;
  /** Every candidate + its coded disposition — the audit payload. */
  dispositions: CandidateDisposition[];
  /** A thread-level short-circuit reason, or null if the veto (if any) was per-candidate. */
  shortCircuit: FollowUpShortCircuit | null;
}

/** Tie-break preference among equal-confidence candidates. Emotional is least-preferred (caution). */
const TYPE_PRIORITY: Record<FollowUpType, number> = {
  factual: 0,
  sensory: 1,
  temporal: 2,
  relational: 3,
  emotional: 4,
};

export function decideFollowUp(input: FollowUpDecisionInput): FollowUpDecision {
  const candidates = input.evaluation.candidates;

  // (1) Thread-level short-circuits. Distress/off-ramp first (safety), then thin-answer, then the
  // hard caps. Every candidate is marked with the short-circuit reason — nothing silent.
  const sc = threadShortCircuit(input);
  if (sc) {
    return {
      selected: null,
      shortCircuit: sc,
      dispositions: candidates.map((c) => ({ candidate: c, reason: sc, selected: false })),
    };
  }

  // (2) Per-candidate eligibility. First failing gate wins (deterministic precedence below).
  const dispositions: CandidateDisposition[] = [];
  const eligible: FollowUpCandidate[] = [];
  for (const c of candidates) {
    const reason = ineligibilityReason(c, input);
    if (reason) dispositions.push({ candidate: c, reason, selected: false });
    else eligible.push(c);
  }

  if (eligible.length === 0) {
    return { selected: null, shortCircuit: null, dispositions };
  }

  // (3) Authoritative rank: confidence desc, tie-break by type priority then seed. The model's
  // ordering is advisory; code owns the final choice.
  const winner = [...eligible].sort(compareCandidates)[0]!;
  for (const c of eligible) {
    dispositions.push({
      candidate: c,
      reason: c === winner ? "selected" : "not_selected",
      selected: c === winner,
    });
  }
  return { selected: winner, shortCircuit: null, dispositions };
}

function threadShortCircuit(input: FollowUpDecisionInput): FollowUpShortCircuit | null {
  if (input.distressed || input.offRampRequested) return "distress_shortcircuit";
  if (input.answerWordCount < input.policy.thinAnswerWordFloor) return "thin_answer";
  if (input.followUpsAskedInThread >= input.policy.maxFollowUpsPerThread) return "over_cap_thread";
  if (input.followUpsAskedInSession >= input.policy.maxFollowUpsPerSession) return "over_cap_session";
  return null;
}

/**
 * Per-candidate veto precedence (first match recorded): emotional-door (hard safety veto) →
 * rapport gate (safety) → duplicate (already covered) → confidence floor (quality). Safety vetoes
 * are checked FIRST and recorded under their own distinct reason even when a candidate is ALSO a
 * duplicate — ADR-0013's payoff is auditability, and an auditor scanning for "did the model try to
 * open a closed emotional door" must not have that undercounted by ordinary dedup noise. Selection
 * outcome is unchanged either way (every branch here means "ineligible"); only the RECORDED reason
 * depends on this ordering. Returns null when the candidate is eligible.
 */
function ineligibilityReason(
  c: FollowUpCandidate,
  input: FollowUpDecisionInput,
): FollowUpDispositionReason | null {
  if (c.type === "emotional" && !c.narratorOpened) return "emotional_door_closed";
  if (c.sensitivity === "high" && !input.rapportEstablished) return "below_rapport";
  if (isDuplicate(c.threadSeed, input.alreadyAskedSeeds)) return "duplicate";
  if (c.confidence < input.policy.confidenceThreshold) return "below_confidence";
  return null;
}

function compareCandidates(a: FollowUpCandidate, b: FollowUpCandidate): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (TYPE_PRIORITY[a.type] !== TYPE_PRIORITY[b.type]) return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
  return a.threadSeed.localeCompare(b.threadSeed);
}

function normSeed(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cheap lexical anti-repeat BACKSTOP, not the primary novelty defense — the evaluator itself
 * receives `alreadyAskedSeeds` and is instructed to propose only novel threads. The substring
 * check here over-matches on word-prefix collisions (e.g. "the war" vs "the warmth of summer"
 * would be flagged as duplicates) — accepted, since a false-positive dedup just costs one
 * candidate, whereas a false negative would let the loop repeat itself.
 */
function isDuplicate(seed: string, priors: ReadonlyArray<string>): boolean {
  const n = normSeed(seed);
  if (!n) return false;
  return priors.some((p) => {
    const q = normSeed(p);
    if (!q) return false;
    return q === n || q.includes(n) || n.includes(q);
  });
}
