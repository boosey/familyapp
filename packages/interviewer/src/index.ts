export type {
  Voice,
  VoiceSpeakInput,
  VoiceSpeakResult,
  AskSource,
  PendingAsk,
  MemorySource,
  PriorStoryMemory,
  AnchorSource,
  BiographicalAnchors,
} from "./contracts";

export {
  ScriptedVoice,
  InMemoryAskSource,
  InMemoryMemorySource,
  InMemoryAnchorSource,
} from "./mocks";

export {
  QUESTION_BANK,
  REMINISCENCE_BUMP_PHASES,
  type BaseQuestion,
  type QuestionCategory,
  type Sensitivity,
  type LifePhase,
} from "./questions/bank";

export {
  RAPPORT_THRESHOLD_TURNS,
  SILENCE_TOLERANCE_MS,
  MEMORY_LOOKBACK_COUNT,
} from "./constants";

export {
  createSessionState,
  ingestNarratorUtterance,
  detectDistress,
  detectOffRamp,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  recordTurnCompleted,
  type SessionState,
  type PromptIntent,
  type PickInput,
} from "./behavior";

export {
  phraseIntent,
  type PhraseInput,
  type PhraseResult,
} from "./phraser";

export {
  createInterviewSession,
  type InterviewerDeps,
  type InterviewSession,
  type InterviewSessionOptions,
  type Turn,
} from "./turn-loop";

export {
  createCoreMemorySource,
  createCoreAnchorSource,
  createCoreAskSource,
} from "./core-adapters";
