export {
  type AuthContext,
  type AuthDecision,
  type ListStoriesForViewerOptions,
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
  type TextDraftInput,
  type CreatedTextDraft,
  type DerivedFields,
  type InterviewerStoryMemory,
  type ApproveAndShareInput,
  type ApproveAndShareResult,
  type OutstandingAnswerDraft,
  type OutstandingDraft,
  type DiscardDraftResult,
  type AppendProseRevisionInput,
  type SaveProseCorrectionInput,
  persistRecordingAndCreateDraft,
  createTextDraft,
  updateDerivedFields,
  transitionStoryState,
  listNarratorMemoryForInterviewer,
  approveAndShareStory,
  applyTranscriptCorrection,
  listOutstandingAnswerDrafts,
  listOutstandingDrafts,
  discardDraftStory,
  appendProseRevision,
  listProseRevisions,
  saveProseCorrection,
  logPolish,
  finishDraft,
  setStoryFamilyTargets,
  computeDefaultFamilyTargets,
  listStoryRecordings,
  appendStoryRecording,
  appendVoiceTakeContribution,
  appendTypedTakeContribution,
  persistTakeRecording,
  updateStoryRecordingTranscript,
  dropStoryRecording,
} from "./story-repository";
// The multi-take set (ADR-0012) surfaced for callers of the take repo above.
export type { StoryRecording } from "@chronicle/db";
export * from "./follow-up-record";
// `getStoryAndRecordingForPipeline` + `PipelineStoryView` are intentionally NOT re-exported
// here. They are a content-surfacing read with no AuthContext; the only legitimate caller is
// the pipeline orchestrator. Import them via `@chronicle/core/pipeline`, which the architecture
// guard restricts to a single file.
export {
  type NarratorProfile,
  type NarratorBiographicalContext,
  getNarratorProfile,
  getNarratorBiographicalContext,
} from "./narrator-profile";
export {
  type NarratorMemoryInput,
  type NarratorMemorySink,
  noopNarratorMemorySink,
} from "./narrator-memory";
export { AuthorizationError, InvariantViolation } from "./errors";
export {
  createAsk,
  listPendingAsksForNarrator,
  listAsksByAsker,
  markAskRouted,
  markAskAnswered,
  type CreateAskInput,
  type PendingAskForNarrator,
  type AskerOwnAsk,
} from "./asks";
export {
  createAccountWithPerson,
  findPersonIdByAuthProviderUserId,
  type SignUpAccountInput,
  type AccountWithPerson,
} from "./accounts";
export {
  completeOnboarding,
  type CompleteOnboardingInput,
} from "./onboarding";
export {
  createFamily,
  getFamily,
  setFamilyDiscovery,
  type CreateFamilyInput,
  type CreateFamilyResult,
} from "./families";
export {
  addMembership,
  listActiveMembershipsForPerson,
  listActiveFamiliesForPerson,
  isActiveMember,
  getStewardPersonId,
  listMembersOfFamily,
  type ActiveFamilyView,
  type FamilyMemberView,
} from "./memberships";
export {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationView,
} from "./invitations";
export {
  createJoinRequest,
  listPendingJoinRequestsForSteward,
  listDecidedJoinRequestsForSteward,
  approveJoinRequest,
  declineJoinRequest,
  listJoinRequestsByRequester,
  type CreateJoinRequestInput,
  type PendingJoinRequest,
  type DecidedJoinRequest,
  type RequesterJoinRequest,
} from "./join-requests";
export {
  createKeywordFamilySearch,
  listDiscoverableFamilies,
  type FamilySearchQuery,
  type FamilySearchResult,
  type FamilySearch,
  type DiscoverableFamily,
} from "./family-search";
export {
  createIntakeRecording,
  saveIntakeTranscript,
  saveIntakeText,
  getIntakeAnswer,
  listAnsweredQuestionKeys,
  appendIntakeRevision,
  listIntakeRevisions,
  logIntakePolish,
  type CreateIntakeRecordingInput,
} from "./intake-answer-repository";
export {
  createAlbumPhoto,
  listAlbumPhotos,
  authorizeAlbumPhotoRead,
  getAlbumPhotoForViewer,
  setAlbumPhotoCaption,
  softDeleteAlbumPhoto,
  type CreateAlbumPhotoInput,
  type AlbumPhotoView,
} from "./album-repository";
