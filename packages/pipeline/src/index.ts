export type {
  WorkingCopyInput,
  WorkingCopyResult,
  WorkingCopySegment,
  WorkingCopyTransformer,
  WordTiming,
  TranscribeInput,
  TranscriptionResult,
  Transcriber,
  LanguageModelMessage,
  LanguageModelRequest,
  LanguageModelResponse,
  LanguageModel,
  JobName,
  JobPayload,
  EnqueuedJob,
  JobHandler,
  JobQueue,
} from "./contracts";

export {
  createDefaultWorkingCopyTransformer,
  mapWorkingCopyMsToOriginalMs,
  type DefaultWorkingCopyOptions,
} from "./working-copy";

export { InProcessJobQueue } from "./job-queue";

export {
  ScriptedTranscriber,
  ScriptedLanguageModel,
  type ScriptedTranscriberScript,
  type ScriptedTranscriberCall,
  type ScriptedLanguageModelScript,
} from "./mocks";

export {
  renderStoryFromTranscript,
  parseRenderResponse,
  type RenderInput,
  type RenderOutput,
} from "./render-story";

export {
  createPipeline,
  type Pipeline,
  type PipelineDeps,
} from "./orchestrator";

export {
  applyVoiceCorrection,
  type ApplyVoiceCorrectionInput,
} from "./correction";

export {
  extractBiographicalProfile,
  augmentProfileFromStory,
  type BiographicalProfileStore,
} from "./extract-biography";

export {
  withTranscriberLogging,
  withLanguageModelLogging,
} from "./observability";

export {
  plog,
  plogError,
  preview,
  startTimer,
  errMsg,
  pipelineLogEnabled,
  beginLogContext,
  withLogContext,
  newCorrelationId,
} from "./logger";
