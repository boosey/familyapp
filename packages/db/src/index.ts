/**
 * Public surface of @chronicle/db.
 *
 * IMPORTANT (the single front door): this entry deliberately does NOT export the raw table
 * objects (`stories`, `media`, ...). Those live behind the `@chronicle/db/schema` subpath, which
 * is imported only by audited modules (the authorization function, the consent ledger, and
 * write paths). An architecture test (packages/core/test/architecture.test.ts) fails CI if any
 * other source file imports the content tables — so "all reads go through one function" is
 * enforced structurally, not by convention. Consumers get types, the client, and the test
 * harness here; to READ story/media content they must go through @chronicle/core.
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
  LifeStatus,
  MembershipRole,
  MembershipStatus,
  StoryState,
  AudienceTier,
  MediaKind,
  ConsentAction,
  AskStatus,
} from "./schema";
export { createPgliteDatabase, type Database } from "./client";
export { createTestDatabase } from "./testing";
