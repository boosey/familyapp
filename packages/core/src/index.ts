export {
  type AuthContext,
  type AuthDecision,
  viewerPersonId,
  decideStoryRead,
  decideMediaRead,
  getStoryForViewer,
  listStoriesForViewer,
  getMediaForViewer,
} from "./authorization";
export {
  type RecordConsentInput,
  recordConsent,
  getConsentHistory,
  isCurrentlyShared,
} from "./consent";
export {
  canTransitionStory,
  assertStoryTransition,
} from "./story-state";
export {
  type RecordingInput,
  type DraftStoryInput,
  type PersistedRecording,
  type DerivedFields,
  type InterviewerStoryMemory,
  type ApproveAndShareInput,
  type ApproveAndShareResult,
  persistRecordingAndCreateDraft,
  updateDerivedFields,
  transitionStoryState,
  listElderMemoryForInterviewer,
  approveAndShareStory,
  applyTranscriptCorrection,
} from "./story-repository";
// `getStoryAndRecordingForPipeline` + `PipelineStoryView` are intentionally NOT re-exported
// here. They are a content-surfacing read with no AuthContext; the only legitimate caller is
// the pipeline orchestrator. Import them via `@chronicle/core/pipeline`, which the architecture
// guard restricts to a single file.
export {
  type ElderProfile,
  type ElderBiographicalContext,
  getElderProfile,
  getElderBiographicalContext,
} from "./elder-profile";
export { AuthorizationError, InvariantViolation } from "./errors";
export {
  createAsk,
  listPendingAsksForElder,
  type CreateAskInput,
  type PendingAskForElder,
} from "./asks";
