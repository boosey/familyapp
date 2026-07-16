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
  JobFailureInfo,
  JobFailureHandler,
  JobQueue,
  PhotoUnderstandingInput,
  PhotoUnderstandingResult,
  PhotoUnderstanding,
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
  ScriptedPhotoUnderstanding,
  type ScriptedTranscriberScript,
  type ScriptedTranscriberCall,
  type ScriptedLanguageModelScript,
  type ScriptedPhotoUnderstandingScript,
  type ScriptedPhotoUnderstandingCall,
} from "./mocks";

export {
  rankPhotosForStory,
  pickPhotoNudge,
  PHOTO_RANK_CAPTION_WEIGHT,
  PHOTO_RANK_YEAR_WEIGHT,
  PHOTO_RANK_YEAR_WINDOW,
  PHOTO_NUDGE_MIN_OVERLAP,
  type PhotoCandidate,
  type StorySignals,
  type RankedPhoto,
} from "./photo-ranker";

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

export { transcribeTakeToRecording } from "./multi-take";

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

export { transcribeIntakeAudio, type IntakeAudio } from "./transcribe-intake";

export {
  polishProse,
  POLISH_SYSTEM_PROMPT,
  type PolishProseInput,
  type PolishProseOutput,
} from "./polish-prose";

export {
  cleanupTake,
  CLEANUP_SYSTEM_PROMPT,
  type CleanupTakeInput,
  type CleanupTakeOutput,
} from "./cleanup-take";

export {
  deriveMetadata,
  METADATA_SYSTEM_PROMPT,
  type DeriveMetadataInput,
  type DeriveMetadataOutput,
} from "./derive-metadata";

export {
  parseSpokenDate,
  parseSpokenDateResponse,
  type SpokenDate,
} from "./parse-spoken-date";
