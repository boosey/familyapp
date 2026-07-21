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
import type { BiographicalProfile, FollowUpPolicy } from "@chronicle/db";
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
import { proposeAndDisposeFollowUp } from "./follow-up-cascade";
import type { SystemFollowUpProbe } from "./system-follow-up-probe";
import type { SystemFollowUpProbeContext } from "./system-follow-up-probe";

export interface InterviewerDeps {
  languageModel: LanguageModel;
  voice: Voice;
  askSource: AskSource;
  memorySource: MemorySource;
  anchorSource: AnchorSource;
  /**
   * Optional gap-driven follow-up evaluator (issue #80). When present, `recordResponse` runs the
   * shared propose cascade (system probes → gap → optional deepen) and queues a winner for the
   * next `follow_up` slot. Prod injects `createGapFollowUpEvaluator(languageModel)`; omit it to
   * keep reflection-only behavior when no probes fire (feature lands dark by default).
   */
  followUpEvaluator?: FollowUpEvaluator;
  /**
   * Optional free-form deepen evaluator (answer-surface cascade stage 3). Interview session
   * typically omits this — reflection still comes from `pickNextIntent` on a long utterance.
   */
  deepenFollowUpEvaluator?: FollowUpEvaluator;
  /**
   * Optional system probes (e.g. temporal dating). Wire dating context via
   * `InterviewSessionOptions.getProbeContext` — see DECISIONS § follow-up cascade / story-dates.
   */
  systemFollowUpProbes?: ReadonlyArray<SystemFollowUpProbe>;
  /** Optional policy override for gap follow-ups; defaults to `resolveFollowUpPolicy({enabled:true})`. */
  followUpPolicy?: Partial<FollowUpPolicy>;
  /** Optional fixed voice id, so the persona is the same every session (a dignity requirement). */
  voiceId?: string;
}

export interface InterviewSessionOptions {
  narratorPersonId: string;
  /** When set, the session was opened via a notification deeplink for this specific Ask. */
  targetAskId?: string;
  /**
   * Optional probe context factory (story-dates hook). Called each `recordResponse` before the
   * cascade. Return dating fields only when an active story has an unresolved date; omit dating
   * to keep the temporal probe N/A. Latch `alreadyAsked` from session state after a temporal ask.
   */
  getProbeContext?: (args: {
    answerTranscript: string;
    temporalFollowUpAsked: boolean;
  }) => SystemFollowUpProbeContext;
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

  // Temporal probe latch (issue #244): true once a temporal follow-up has been ASKED this session.
  // Skip / "I don't know" is terminal — never re-ask. Any temporal origin (system or gap) counts.
  let temporalFollowUpAsked = false;

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
    if (
      intent.kind === "follow_up" &&
      (intent.origin === "gap" || intent.origin === "system") &&
      intent.gapKind === "temporal"
    ) {
      temporalFollowUpAsked = true;
    }
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

    // Drop any follow-up left queued from a prior turn before we (maybe) queue a fresh one. If a
    // higher-priority intent (intake/ask) preempted the follow_up slot last turn, `recordTurnCompleted`
    // never cleared the queue — left alone it would resurface later, stale and out of context, on a
    // subsequent thin answer that skips detection. Clearing here bounds a queued follow-up to the
    // very next prompt (issue #80).
    state.pendingGapFollowUp = null;

    // Propose cascade (system probes → gap → optional deepen). Runs BEFORE intake extraction so a
    // follow-up can be queued for the next turn. Deliberately after `ingestNarratorUtterance` so
    // distress / off-ramp flags are already set. Best-effort: any failure leaves reflection-only
    // behavior. Skipped for structured intake answers.
    const key = pendingIntakeKey;
    if (key === null) {
      await detectAndQueueGapFollowUp(utterance);
    }

    pendingIntakeKey = null;
    if (!key || state.distressed || state.offRampRequested) return;
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
   * Thin wrapper over `proposeAndDisposeFollowUp`. Gates:
   *   - no gap evaluator AND no probes AND no deepen → skip (reflection-only).
   *   - distress / off-ramp                         → cascade short-circuits (no LLM spend).
   *   - answer below GAP_DETECTION_MIN_ANSWER_WORDS  → skip (too thin; probes that need dating
   *                                                     still require a substantive telling).
   * A selected winner is queued as `pendingGapFollowUp` with origin + gapKind for the phraser.
   */
  async function detectAndQueueGapFollowUp(utterance: string): Promise<void> {
    const hasProbes = (deps.systemFollowUpProbes?.length ?? 0) > 0;
    if (!deps.followUpEvaluator && !deps.deepenFollowUpEvaluator && !hasProbes) return;
    if (state.distressed || state.offRampRequested) return;
    const answerWordCount = utterance.trim().split(/\s+/).filter(Boolean).length;
    if (answerWordCount < GAP_DETECTION_MIN_ANSWER_WORDS) return;

    const policy = resolveFollowUpPolicy({ enabled: true, ...deps.followUpPolicy });
    const rapportEstablished = state.turnCount >= RAPPORT_THRESHOLD_TURNS;
    const probeContext =
      opts.getProbeContext?.({ answerTranscript: utterance, temporalFollowUpAsked }) ?? {
        answerTranscript: utterance,
      };

    try {
      const result = await proposeAndDisposeFollowUp({
        probes: deps.systemFollowUpProbes,
        probeContext,
        gapEvaluator: deps.followUpEvaluator,
        deepenEvaluator: deps.deepenFollowUpEvaluator,
        evaluationInput: {
          answerTranscript: utterance,
          promptText: lastSpokenText ?? "",
          alreadyAskedSeeds: state.askedGapSeeds,
          coveredCategories: [...state.coveredCategories],
          followUpsAskedInThread: state.gapFollowUpsAskedInSession,
          rapportEstablished,
        },
        decide: {
          policy,
          answerWordCount,
          followUpsAskedInThread: state.gapFollowUpsAskedInSession,
          followUpsAskedInSession: state.gapFollowUpsAskedInSession,
          distressed: state.distressed,
          offRampRequested: state.offRampRequested,
          rapportEstablished,
          alreadyAskedSeeds: state.askedGapSeeds,
        },
      });
      if (result.decision.selected && (result.origin === "system" || result.origin === "gap")) {
        state.pendingGapFollowUp = {
          candidate: result.decision.selected,
          gapKind: result.gapKind ?? "identity",
          origin: result.origin,
        };
      }
    } catch (e) {
      // Cascade is best-effort — a failure or timeout must never break the session.
      // eslint-disable-next-line no-console
      console.warn("follow-up cascade failed (narrator=%s):", state.narratorPersonId, e);
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
