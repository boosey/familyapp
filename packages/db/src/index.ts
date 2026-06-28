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
  ElderSession,
  NewElderSession,
  Invitation,
  NewInvitation,
  JoinRequest,
  NewJoinRequest,
  MockAuthUser,
  NewMockAuthUser,
  LifeStatus,
  MembershipRole,
  MembershipStatus,
  StoryState,
  AudienceTier,
  MediaKind,
  ConsentAction,
  AskStatus,
  InvitationStatus,
  JoinRequestStatus,
} from "./schema";
export { createPgliteDatabase, type Database } from "./client";
export {
  createPostgresDatabase,
  type PostgresClientOptions,
} from "./postgres-client";
export { createTestDatabase } from "./testing";
export { applyMigrations, applyMigrationsToPostgres } from "./migrate";
