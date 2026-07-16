/**
 * Turn loop — the runnable wrapper that pulls all the seams together. Each call to `nextTurn`
 * composes ONE turn from the four inputs the spec names (base bank, pending Asks, session
 * memory, biographical anchors), asks the picker for the Intent, asks the LLM to phrase it,
 * and asks the Voice seam to synthesize speech. The caller (the narrator surface, or a test)
 * then plays the audio, captures the narrator's response, and feeds it back via `recordResponse`
 * before the next `nextTurn` call.
 *
 * The loop is INTENTIONALLY a function-per-turn, not a long-running goroutine. The narrator
 * surface (Phase 1: a thin web page) drives pacing; this module is the brain it consults.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { BiographicalProfile, FollowUpPolicy, FollowUpType } from "@chronicle/db";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  FollowUpEvaluator,
  MemorySource,
  PriorStoryMemory,
  Voice,
  VoiceSpeakResult,
} from "./contracts";
import {
  createSessionState,
  decideFollowUp,
  ingestNarratorUtterance,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  recordTurnCompleted,
  type PromptIntent,
  type SessionState,
} from "./behavior";
import {
  GAP_DETECTION_MIN_ANSWER_WORDS,
  MEMORY_LOOKBACK_COUNT,
  RAPPORT_THRESHOLD_TURNS,
} from "./constants";
import { phraseIntent } from "./phraser";
import { extractIntakeAnswer } from "./intake-extraction";
import { INTAKE_QUESTIONS } from "./questions/intake";
import { resolveFollowUpPolicy } from "./follow-up-policy";
import type { GapKind } from "./gap-detection";

export interface InterviewerDeps {
  languageModel: LanguageModel;
  voice: Voice;
  askSource: AskSource;
  memorySource: MemorySource;
  anchorSource: AnchorSource;
  /**
   * Optional gap-driven follow-up evaluator (issue #80). When present, `recordResponse` runs a thin
   * gap-detection pass over the narrator's answer, disposes the candidates through `decideFollowUp`
   * (so every behavior gate applies), and queues the winner for the next `follow_up` slot. Prod
   * injects `createGapFollowUpEvaluator(languageModel)`; omit it to keep the loop's original
   * reflection-only follow-up behavior (feature lands dark by default).
   */
  followUpEvaluator?: FollowUpEvaluator;
  /** Optional policy override for gap follow-ups; defaults to `resolveFollowUpPolicy({enabled:true})`. */
  followUpPolicy?: Partial<FollowUpPolicy>;
  /** Optional fixed voice id, so the persona is the same every session (a dignity requirement). */
  voiceId?: string;
}

/**
 * Best-effort reverse map FollowUpType → GapKind, used ONLY to give the phraser a phrasing angle for
 * a queued gap follow-up. The forward map (gap-detection.ts) is many-to-one — spatial/causal/identity
 * all become `factual` — so this reverse is lossy by construction. That is acceptable: `gapKind` is a
 * hint the phraser uses to shade an OPEN question, never a fact it asserts, and the threadSeed carries
 * the real content. `factual` reverses to `identity` (the most neutral "what/which" angle).
 */
const FOLLOW_UP_TYPE_TO_GAP_KIND: Record<FollowUpType, GapKind> = {
  temporal: "temporal",
  relational: "relational",
  factual: "identity",
  sensory: "identity",
  emotional: "identity",
};

export interface InterviewSessionOptions {
  narratorPersonId: string;
  /** When set, the session was opened via a notification deeplink for this specific Ask. */
  targetAskId?: string;
}

export interface Turn {
  intent: PromptIntent;
  spokenText: string;
  audio: VoiceSpeakResult;
  /** Snapshot of state AFTER this turn — useful for tests and observability. */
  state: SessionState;
}

export interface InterviewSession {
  /** Compose, phrase, and synthesize the next turn. Returns null if the session is winding down
   * and there is nothing more to say (the loop ends cleanly). */
  nextTurn(): Promise<Turn>;
  /** Feed the narrator's response into the session state so the next turn can react. */
  recordResponse(utterance: string): Promise<void>;
  /** Direct read of the running state (tests & observability). */
  getState(): SessionState;
  /** Direct read of the memory snapshot loaded at start (tests & observability). */
  getPriorStories(): ReadonlyArray<PriorStoryMemory>;
  /** Direct read of the loaded biographical anchors. */
  getAnchors(): BiographicalAnchors | null;
}

/**
 * Create an interview session bound to one narrator. Loads memory + anchors ONCE up front; the
 * loop then picks/phrases/speaks per turn. The single up-front load keeps the session a stable
 * snapshot — a story approved mid-session does not perturb the picker until the next session.
 * That's a deliberate choice: behavior policy is auditable as "what the loop saw at start".
 */
export async function createInterviewSession(
  deps: InterviewerDeps,
  opts: InterviewSessionOptions,
): Promise<InterviewSession> {
  const state = createSessionState(opts.narratorPersonId);
  const [priorStories, anchors, pendingAsks] = await Promise.all([
    deps.memorySource.recentStoriesForNarrator(opts.narratorPersonId, MEMORY_LOOKBACK_COUNT),
    deps.anchorSource.loadForNarrator(opts.narratorPersonId),
    deps.askSource.pendingForNarrator(opts.narratorPersonId),
  ]);
  primeCoveredCategoriesFromPrior(state, priorStories);

  // Tracks the intake field the LAST served turn asked about, so the matching `recordResponse`
  // knows which extraction to run. Cleared after every response (intake or not).
  let pendingIntakeKey: keyof BiographicalProfile | null = null;

  // The question the last served turn actually spoke — the prompt context gap detection reads so it
  // knows what the narrator was answering. Null until the first turn is served.
  let lastSpokenText: string | null = null;

  async function nextTurn(): Promise<Turn> {
    const intent = pickNextIntent({ state, pendingAsks, priorStories, anchors, targetAskId: opts.targetAskId });
    if (intent.kind === "intake") pendingIntakeKey = intent.questionKey;
    const phrased = await phraseIntent(deps.languageModel, {
      intent,
      anchors,
      priorStories,
      isFirstSession: priorStories.length === 0,
    });
    const audio = await deps.voice.speak({
      text: phrased.spokenText,
      ...(deps.voiceId !== undefined ? { voiceId: deps.voiceId } : {}),
    });
    lastSpokenText = phrased.spokenText;
    recordTurnCompleted(state, intent);
    // Close the relay's first half: notify the source that this Ask has been routed (queued
    // → routed). The DB adapter flips the row so the asker's hub view stops showing
    // `queued`; the in-memory mock no-ops. Best-effort — a failure here must NOT erase the
    // synthesized turn the narrator is about to hear, so we swallow and log to console.
    if (intent.kind === "ask") {
      try {
        await deps.askSource.markRouted(intent.askId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("askSource.markRouted failed (ask=%s):", intent.askId, e);
      }
    }
    return { intent, spokenText: phrased.spokenText, audio, state };
  }

  async function recordResponse(utterance: string): Promise<void> {
    ingestNarratorUtterance(state, utterance);

    // Gap-driven follow-up detection (issue #80). Runs BEFORE intake extraction so a gap follow-up
    // can be queued for the next turn. Deliberately after `ingestNarratorUtterance` so distress /
    // off-ramp flags are already set and can short-circuit detection. Best-effort: any failure
    // leaves the loop in its reflection-only behavior — a broken detector never blocks the session.
    await detectAndQueueGapFollowUp(utterance);

    const key = pendingIntakeKey;
    pendingIntakeKey = null;
    if (!key) return;
    const question = INTAKE_QUESTIONS.find((q) => q.key === key);
    if (!question) return;
    try {
      const value = await extractIntakeAnswer(deps.languageModel, question, utterance);
      if (value !== null && value !== undefined) {
        await deps.anchorSource.writeProfileField(state.narratorPersonId, key, value as never);
      }
    } catch (e) {
      // Extraction is best-effort: a failure must not break the session. The field stays null and
      // the question is re-asked next session (askedIntakeKeys only guards within this session).
      // eslint-disable-next-line no-console
      console.warn("intake extraction failed (key=%s):", key, e);
    }
  }

  /**
   * The gap-detection → dispose → queue step. Thin and heavily gated:
   *   - no evaluator configured                         → skip (reflection-only mode).
   *   - distress / off-ramp on this utterance           → skip (a gap NEVER pushes into pain; the
   *                                                        picker would wind_down anyway, but we
   *                                                        also refuse to SPEND an LLM call).
   *   - answer below GAP_DETECTION_MIN_ANSWER_WORDS      → skip (too thin to have real gaps).
   * Then `decideFollowUp` applies the remaining gates (rapport, anti-repeat, confidence, caps,
   * per-candidate vetoes). A selected candidate is queued as `pendingGapFollowUp`; nothing selected
   * leaves the queue empty and the loop reflects/asks as before.
   */
  async function detectAndQueueGapFollowUp(utterance: string): Promise<void> {
    const evaluator = deps.followUpEvaluator;
    if (!evaluator) return;
    if (state.distressed || state.offRampRequested) return;
    const answerWordCount = utterance.trim().split(/\s+/).filter(Boolean).length;
    if (answerWordCount < GAP_DETECTION_MIN_ANSWER_WORDS) return;

    const policy = resolveFollowUpPolicy({ enabled: true, ...deps.followUpPolicy });
    try {
      const evaluation = await evaluator.evaluate({
        answerTranscript: utterance,
        // What the narrator was answering. Empty string is fine — the detector reads the answer.
        promptText: lastSpokenText ?? "",
        alreadyAskedSeeds: state.askedGapSeeds,
        coveredCategories: [...state.coveredCategories],
        followUpsAskedInThread: state.gapFollowUpsAskedInSession,
        rapportEstablished: state.turnCount >= RAPPORT_THRESHOLD_TURNS,
      });
      const decision = decideFollowUp({
        evaluation,
        policy,
        answerWordCount,
        followUpsAskedInThread: state.gapFollowUpsAskedInSession,
        followUpsAskedInSession: state.gapFollowUpsAskedInSession,
        distressed: state.distressed,
        offRampRequested: state.offRampRequested,
        rapportEstablished: state.turnCount >= RAPPORT_THRESHOLD_TURNS,
        alreadyAskedSeeds: state.askedGapSeeds,
      });
      if (decision.selected) {
        state.pendingGapFollowUp = {
          candidate: decision.selected,
          gapKind: FOLLOW_UP_TYPE_TO_GAP_KIND[decision.selected.type],
        };
      }
    } catch (e) {
      // Gap detection is best-effort — a failure or timeout must never break the session.
      // eslint-disable-next-line no-console
      console.warn("gap-detection follow-up failed (narrator=%s):", state.narratorPersonId, e);
    }
  }

  return {
    nextTurn,
    recordResponse,
    getState: () => state,
    getPriorStories: () => priorStories,
    getAnchors: () => anchors,
  };
}
