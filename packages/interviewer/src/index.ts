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
  BiographicalProfile,
  StoryDateSink,
  PersistResolvedStoryDateInput,
} from "./contracts";

export {
  ScriptedVoice,
  InMemoryAskSource,
  InMemoryMemorySource,
  InMemoryAnchorSource,
  InMemoryStoryDateSink,
  ScriptedFollowUpEvaluator,
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
  decideFollowUp,
  type SessionState,
  type PromptIntent,
  type PickInput,
  type FollowUpDecisionInput,
  type FollowUpDecision,
  type FollowUpShortCircuit,
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
  createCoreStoryDateSink,
} from "./core-adapters";

export {
  INTAKE_QUESTIONS,
  nextIntakeQuestion,
  type IntakeQuestion,
} from "./questions/intake";

export { extractIntakeAnswer } from "./intake-extraction";

export * from "./follow-up-policy";
export type {
  FollowUpEvaluationInput,
  FollowUpEvaluation,
  FollowUpEvaluator,
  FollowUpCandidate,
} from "./contracts";
export {
  createLlmFollowUpEvaluator,
  parseCandidates,
} from "./follow-up-evaluator";

// Gap-driven follow-up (issue #80).
export {
  extractGaps,
  parseGaps,
  gapsToFollowUpCandidates,
  type Gap,
  type GapKind,
  type GapDetectionInput,
  type GapDetectionResult,
} from "./gap-detection";
export { createGapFollowUpEvaluator } from "./gap-evaluator";
export {
  resolveGapPrompt,
  CURRENT_GAP_DETECTION_VERSION,
  type PromptPurpose,
  type PromptVendor,
  type ResolvedPrompt,
} from "./prompts/gap-prompts";
export {
  GAP_DETECTION_MAX_GAPS,
  GAP_DETECTION_MIN_ANSWER_WORDS,
  GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
} from "./constants";
