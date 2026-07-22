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
  applyResolvedStoryDate,
  transitionStoryState,
  markStoryProcessingFailed,
  beginStoryRetry,
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
  editStoryDetails,
  editStoryDate,
  editStoryProse,
  retargetStoryFamilies,
  setStoryFavorite,
  getFavoriteState,
  listFavoriteStoriesForViewer,
  setStoryLike,
  getLikeState,
  tagStorySubject,
  untagStorySubject,
  listStorySubjects,
  listStoriesAboutPerson,
  listStoriesNarratedByPerson,
  type EditStoryDetailsInput,
  type EditStoryDateInput,
  type EditStoryProseInput,
  type FavoriteState,
  type LikeState,
  type StorySubjectView,
  type TagStorySubjectInput,
  type TagStorySubjectResult,
} from "./story-repository";
// ADR-0026 (tiered hybrid): Tier A stated-calendar parse (deterministic, no LLM), the Tier B pure
// calculator over a validated structured ref, and the defensive parser. The live path uses Tier A;
// the finish-time backstop recognizes soft language via an LLM ref → the same calculator.
export {
  resolveStatedStoryDate,
  resolveTemporalRef,
  parseTemporalProposal,
  type ResolveStoryDateInput,
  type ResolveTemporalRefInput,
  type StoryDateOccurrence,
  type StoryDateResolution,
  type LifeEventAnchor,
  type TemporalRef,
  type TemporalRefType,
  type TemporalProposal,
  type HolidayId,
  type LifeStageId,
  type EraId,
  type SeasonId,
  type AnchorKind,
} from "./resolve-story-date";
// ADR-0026 (#245): the pure stated-life-event extractor — spots an anchor FACT in a telling
// ("we married in '58") so it can be stored on the narrator as a reusable life event.
export {
  extractStatedLifeEvents,
  type ExtractStatedLifeEventsInput,
  type StatedLifeEvent,
} from "./resolve-story-date";
// ADR-0026 / #321: shared live Story date update policy (Tier A + rank + life-event extract).
// Turn-loop and answer surface both call this; finish-time backstop stays in pipeline.
export {
  OCCURRENCE_PRECISION_RANK,
  occurrencePrecisionRank,
  deriveLiveStoryDateUpdate,
  type DeriveLiveStoryDateUpdateInput,
  type DeriveLiveStoryDateUpdateResult,
} from "./live-story-date";
// ADR-0026: the Life event read side (the reusable anchors derivation resolves against) and the
// write side (#245) — capture from tellings, idempotent per person + kind + date.
export {
  listLifeEventsForPerson,
  recordStatedLifeEvent,
  type RecordStatedLifeEventResult,
} from "./life-events";
// The multi-take set (ADR-0012) surfaced for callers of the take repo above.
export type { StoryRecording } from "@chronicle/db";
// ADR-0016 (tree renderer): card color only, mirrors `TreeNode.sex`.
export type { PersonSex } from "@chronicle/db";
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
export { eraseStory, eraseAsk, eraseVoiceCaption, eraseAccount } from "./erasure-repository";
export type { EraseResult, EraseAccountResult } from "./erasure-repository";
export {
  listStorySharedPingRecipients,
  type StorySharedPingContext,
  type StorySharedPingKind,
  type StorySharedPingRecipient,
} from "./story-shared-pings";
export {
  resolveQuestionsForMePing,
  type QuestionsForMePingContext,
} from "./questions-for-me-pings";
export {
  DEFAULT_NOTIFICATION_FREQUENCY,
  NOTIFICATION_STREAMS,
  getNotificationStreamFrequency,
  setNotificationStreamFrequency,
  listNotificationStreamFrequencies,
} from "./notification-prefs";
export {
  allowsImmediateDelivery,
  shouldDeliverImmediately,
} from "./notification-immediate";
export {
  AlreadyFamilyMemberError,
  AuthorizationError,
  InvariantViolation,
  ThrottleError,
} from "./errors";
export {
  createAsk,
  listPendingAsksForNarrator,
  listAsksByAsker,
  listAskSubjectPhotos,
  markAskRouted,
  markAskAnswered,
  type CreateAskInput,
  type PendingAskForNarrator,
  type AskerOwnAsk,
} from "./asks";
export {
  createAccountWithPerson,
  findPersonIdByAuthProviderUserId,
  reconcileAccountProfile,
  deactivateAccountByAuthProviderUserId,
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  resolveAccountIdByVerifiedPhone,
  attachIdentity,
  type SignUpAccountInput,
  type AccountWithPerson,
  type ReconcileAccountProfileInput,
  type ReconcileAccountResult,
  type DeactivateAccountResult,
} from "./accounts";
export {
  completeOnboarding,
  type CompleteOnboardingInput,
} from "./onboarding";
export {
  updatePersonIdentity,
  updatePersonDisplayName,
  updatePersonSpokenName,
  updatePersonBirthDate,
  updatePersonBirthYear,
  updatePersonSex,
  updatePersonLifeStatus,
  canEditPerson,
  updatePersonIdentityAsEditor,
  type UpdatePersonIdentityInput,
  type EditPersonReason,
  type EditPersonDecision,
  type EditPersonPatch,
} from "./person-identity";
export { updateBiographicalAnchor } from "./person-anchors";
export {
  createFamily,
  getFamily,
  setFamilyDiscovery,
  updateFamily,
  listFamiliesStewardedBy,
  type CreateFamilyInput,
  type CreateFamilyResult,
  type UpdateFamilyInput,
  type StewardedFamilyView,
} from "./families";
export {
  addMembership,
  designateNarrator,
  listActiveMembershipsForPerson,
  listActiveFamiliesForPerson,
  isActiveMember,
  getStewardPersonId,
  listMembersOfFamily,
  setMemberNonFamily,
  endMembership,
  type ActiveFamilyView,
  type FamilyMemberView,
  type SetMemberNonFamilyInput,
  type EndMembershipInput,
} from "./memberships";
export {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  getInvitationDeliveryContext,
  getInvitationTokenForDelivery,
  recordInviteDelivery,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationView,
  type InvitationDeliveryContext,
} from "./invitations";
export { sealToken, openToken, resolveSealKey } from "./token-seal";
export {
  findActiveFamilyMemberByContact,
  type ConflictingFamilyMember,
} from "./invite-member-guard";
export {
  listPendingInvitationsForPerson,
  dismissInvitationForAccount,
  type PendingInvitationMatch,
} from "./invite-discovery";
export {
  reapUnacceptedInvitees,
  type ReapResult,
} from "./person-housekeeping";
export {
  resolveKinshipProjection,
  normalizeEdgeEndpoints,
  deriveKin,
  listMyKin,
  listUnplacedMembers,
  listGovernableKinEdges,
  listPlacedPersons,
  resolveKinshipTree,
  inviteStatusFor,
  canViewerSeePerson,
  personVisibleToViewerAcrossFamilies,
  bothEndpointsIdentified,
  DEFAULT_TREE_WINDOW,
  type KinshipProjection,
  type ResolvedKinshipEdge,
  type KinRelation,
  type DerivedKin,
  type KinListEntry,
  type UnplacedMember,
  type GovernableKinEdge,
  type TreeWindow,
  type TreeNode,
  type KinshipTreeData,
  type PlacedPersonView,
} from "./kinship-repository";
export {
  addRelative,
  linkExistingMember,
  affirmEdge,
  denyEdge,
  correctEdge,
  hideEdge,
  unhideEdge,
  reconcileMentionIntoAccount,
  type ReconcileMentionInput,
  type ReconcileResult,
  type AddRelativeInput,
  type AddRelativeResult,
  type AddRelativeRelation,
  type LinkExistingMemberInput,
  type LinkExistingMemberResult,
  type EdgeRef,
  type KinshipEdgeActionResult,
  type CorrectEdgeInput,
} from "./kinship-write";
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
  listAlbumPhotosDetailed,
  listPhotosContributedByPerson,
  authorizeAlbumPhotoRead,
  getAlbumPhotoForViewer,
  setAlbumPhotoCaption,
  softDeleteAlbumPhoto,
  assertPersonCanAccessAlbumPhoto,
  tagPhotoSubject,
  untagPhotoSubject,
  listPhotoSubjects,
  tagPhotoPerson,
  untagPhotoPerson,
  listPhotoPeople,
  tagPhotoPlace,
  untagPhotoPlace,
  listPhotoPlaces,
  listPlacesForFamily,
  retargetPhotoFamilies,
  getAlbumPhotoDetail,
  type CreateAlbumPhotoInput,
  type AlbumPhotoView,
  type AlbumPhotoDetailedRow,
  type AlbumPhotoCard,
  type PhotoTagPersonView,
  type PhotoPlaceView,
  type TagPhotoPersonInput,
  type TagPhotoPersonResult,
  type TagPhotoPlaceInput,
  type TagPhotoPlaceResult,
  type AlbumPhotoDetailView,
  type ListAlbumPhotosOptions,
  type ListAlbumPhotosDetailedOptions,
} from "./album-repository";
// The album-read defensive cap (#217) — the web pickers import it to bound their deduped union and
// to label the cap-hit telemetry breadcrumb with the same ceiling the core reads enforce.
export { ALBUM_PHOTO_QUERY_CAP } from "./constants";
export {
  type PlaceSuggester,
  nullPlaceSuggester,
} from "./place-suggester";
export {
  attachPhotoToStory,
  attachPhotoToStoryTx,
  detachStoryImage,
  setStoryCover,
  reorderStoryImages,
  listStoryImages,
  getStoryCoverPhotoId,
  loadStoryCovers,
  loadStoryGalleryPhotoIds,
  type StoryImageView,
} from "./story-image-repository";
