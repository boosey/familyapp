/**
 * Turn loop — the runnable wrapper that pulls all the seams together. Each call to `nextTurn`
 * composes ONE turn from the four inputs the spec names (base bank, pending Asks, session
 * memory, biographical anchors), asks the picker for the Intent, asks the LLM to phrase it,
 * and asks the Voice seam to synthesize speech. The caller (the elder surface, or a test)
 * then plays the audio, captures the elder's response, and feeds it back via `recordResponse`
 * before the next `nextTurn` call.
 *
 * The loop is INTENTIONALLY a function-per-turn, not a long-running goroutine. The elder
 * surface (Phase 1: a thin web page) drives pacing; this module is the brain it consults.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  MemorySource,
  PriorStoryMemory,
  Voice,
  VoiceSpeakResult,
} from "./contracts";
import {
  MEMORY_LOOKBACK_COUNT,
  createSessionState,
  ingestElderUtterance,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  recordTurnCompleted,
  type PromptIntent,
  type SessionState,
} from "./behavior";
import { phraseIntent } from "./phraser";

export interface InterviewerDeps {
  languageModel: LanguageModel;
  voice: Voice;
  askSource: AskSource;
  memorySource: MemorySource;
  anchorSource: AnchorSource;
  /** Optional fixed voice id, so the persona is the same every session (a dignity requirement). */
  voiceId?: string;
}

export interface InterviewSessionOptions {
  elderPersonId: string;
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
  /** Feed the elder's response into the session state so the next turn can react. */
  recordResponse(utterance: string): void;
  /** Direct read of the running state (tests & observability). */
  getState(): SessionState;
  /** Direct read of the memory snapshot loaded at start (tests & observability). */
  getPriorStories(): ReadonlyArray<PriorStoryMemory>;
  /** Direct read of the loaded biographical anchors. */
  getAnchors(): BiographicalAnchors | null;
}

/**
 * Create an interview session bound to one elder. Loads memory + anchors ONCE up front; the
 * loop then picks/phrases/speaks per turn. The single up-front load keeps the session a stable
 * snapshot — a story approved mid-session does not perturb the picker until the next session.
 * That's a deliberate choice: behavior policy is auditable as "what the loop saw at start".
 */
export async function createInterviewSession(
  deps: InterviewerDeps,
  opts: InterviewSessionOptions,
): Promise<InterviewSession> {
  const state = createSessionState(opts.elderPersonId);
  const [priorStories, anchors, pendingAsks] = await Promise.all([
    deps.memorySource.recentStoriesForElder(opts.elderPersonId, MEMORY_LOOKBACK_COUNT),
    deps.anchorSource.loadForElder(opts.elderPersonId),
    deps.askSource.pendingForElder(opts.elderPersonId),
  ]);
  primeCoveredCategoriesFromPrior(state, priorStories);

  async function nextTurn(): Promise<Turn> {
    const intent = pickNextIntent({ state, pendingAsks, priorStories });
    const phrased = await phraseIntent(deps.languageModel, {
      intent,
      anchors,
      priorStories,
    });
    const audio = await deps.voice.speak({
      text: phrased.spokenText,
      ...(deps.voiceId !== undefined ? { voiceId: deps.voiceId } : {}),
    });
    recordTurnCompleted(state, intent);
    return { intent, spokenText: phrased.spokenText, audio, state };
  }

  function recordResponse(utterance: string): void {
    ingestElderUtterance(state, utterance);
  }

  return {
    nextTurn,
    recordResponse,
    getState: () => state,
    getPriorStories: () => priorStories,
    getAnchors: () => anchors,
  };
}
