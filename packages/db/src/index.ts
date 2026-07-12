/**
 * Public surface of @chronicle/db.
 *
 * IMPORTANT (the single front door): this entry deliberately does NOT export the raw table
 * objects (`stories`, `media`, ...). Those live behind the `@chronicle/db/schema` subpath, which
 * is imported only by audited modules (the authorization function, the consent ledger, and
 * write paths). An architecture test (packages/core/test/architecture.test.ts) fails CI if any
 * other source file imports the content tables — so "all reads go through one function" is
 * enforced structurally, not by convention. The client IS exported here (apps need to open a
 * connection), but it carries no relational query API (see client.ts: schema is not registered),
 * so holding the client grants no content read on its own — you still need a guarded table
 * object. To READ story/media content, go through @chronicle/core.
 */
export type {
  Person,
  NewPerson,
  Account,
  NewAccount,
  Family,
  NewFamily,
  Membership,
  NewMembership,
  Media,
  NewMedia,
  Story,
  NewStory,
  ConsentRecord,
  NewConsentRecord,
  Ask,
  NewAsk,
  AskFamily,
  NewAskFamily,
  LinkSession,
  NewLinkSession,
  Invitation,
  NewInvitation,
  JoinRequest,
  NewJoinRequest,
  MockAuthUser,
  NewMockAuthUser,
  GooglePhotosConnection,
  NewGooglePhotosConnection,
  StoryView,
  NewStoryView,
  StoryFamily,
  NewStoryFamily,
  LifeStatus,
  MembershipRole,
  MembershipStatus,
  StoryState,
  StoryKind,
  AudienceTier,
  MediaKind,
  ConsentAction,
  AskStatus,
  InvitationStatus,
  JoinRequestStatus,
  BiographicalProfile,
  ProseRevision,
  NewProseRevision,
  ProseRevisionLevel,
  IntakeAnswer,
  NewIntakeAnswer,
  IntakeRevision,
  NewIntakeRevision,
  IntakeOrigin,
  StoryRecording,
  NewStoryRecording,
  FollowUpDecisionRow,
  NewFollowUpDecisionRow,
  FamilyPhoto,
  NewFamilyPhoto,
  FamilyPhotoFamily,
  NewFamilyPhotoFamily,
  PhotoSource,
  StoryImage,
  NewStoryImage,
  StoryImageProvenance,
  AskSubjectPhoto,
  NewAskSubjectPhoto,
  StoryFavorite,
  NewStoryFavorite,
  StoryLike,
  NewStoryLike,
  PersonOrigin,
  KinshipAssertion,
  NewKinshipAssertion,
  KinshipSubjectHide,
  NewKinshipSubjectHide,
  KinshipEdgeType,
  KinshipNature,
  KinshipState,
} from "./schema";
export type {
  FollowUpType,
  FollowUpSensitivity,
  FollowUpCandidate,
  FollowUpDispositionReason,
  CandidateDisposition,
  FollowUpOutcome,
  FollowUpPolicy,
} from "./follow-up-types";
export { createPgliteDatabase, type Database } from "./client";
export {
  createPostgresDatabase,
  type PostgresClientOptions,
} from "./postgres-client";
export { createTestDatabase } from "./testing";
export { applySchema, resetSchema } from "./migrate";
// NOTE: `runMigrations` is intentionally NOT re-exported here. It is a BUILD-TIME-ONLY utility
// (invoked solely by scripts/migrate.ts via a direct relative import, run by `db:migrate` in the
// Vercel buildCommand). Re-exporting it from the package entry pulled run-migrations.ts into the
// Next.js APP bundle (index.ts → runtime.ts → server actions), where webpack tried to statically
// resolve its `new URL("../drizzle/migrations", import.meta.url)` as a module and failed the build.
// Keeping it off the public surface keeps the migrator out of the app bundle entirely.
export {
  parseExpectedSchema,
  introspectSchema,
  diffSchema,
  assertSchemaParity,
  assertPostgresSchemaParity,
  type SchemaShape,
  type SqlRunner,
  type AssertSchemaParityOptions,
} from "./schema-parity";
