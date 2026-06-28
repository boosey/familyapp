/**
 * The Family Chronicle data model — Part II of the spec, made executable.
 *
 * Three things naive models fuse are kept as three independent dials:
 *   - WHO a person is        -> `persons`            (identity; the spine)
 *   - which families they're in -> `memberships`     (plural, revocable link, carries role+status)
 *   - what gets shared where  -> `stories.audienceTier` (visibility, evaluated per Membership)
 *
 * INVARIANTS encoded here (and enforced further by triggers in the SQL migrations):
 *   - The Person owns ALL expressive content (stories, media, consent). A Family owns nothing.
 *   - A Story is owned by exactly one Person and is NEVER duplicated per family. "Sharing" is a
 *     visibility computation against memberships, so there is no story<->family copy table.
 *   - The canonical Recording (audio Media) is required on every Story and is immutable.
 *   - The consent ledger is append-only (revocation = a new superseding row).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums — the shared vocabulary of states/tiers/roles (Part II)
// ---------------------------------------------------------------------------

/** Gates posthumous behavior downstream (story-will, time-gated release — seams). */
export const lifeStatusEnum = pgEnum("life_status", ["living", "deceased"]);

/** Phase 0 needs exactly these three; the model leaves room for more. */
export const membershipRoleEnum = pgEnum("membership_role", [
  "narrator",
  "member",
  "steward",
]);

/** Divorce ends a membership; estrangement pauses one. Nothing is ever deleted. */
export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "paused",
  "ended",
]);

/** Story lifecycle. A story is `private` (see audienceTier) and `draft` from birth. */
export const storyStateEnum = pgEnum("story_state", [
  "draft",
  "pending_approval",
  "approved",
  "shared",
  "archived",
]);

/**
 * The single visibility dial. `branch` is stored faithfully (non-lossy) even though Phase 0
 * may enforce it as equivalent to `family` until branch structure is modeled (a later seam).
 */
export const audienceTierEnum = pgEnum("audience_tier", [
  "private",
  "branch",
  "family",
  "public",
]);

/** photo/document are seams for later media kinds; Phase 1 uses the two audio kinds. */
export const mediaKindEnum = pgEnum("media_kind", [
  "story_audio",
  "approval_audio",
  "photo",
  "document",
]);

/** The event types the MVP generates. The ledger is shaped to accept more without migration. */
export const consentActionEnum = pgEnum("consent_action", [
  "approved_for_sharing",
  "set_audience_tier",
  "revoked",
  "paused_membership",
]);

/** The asked-question relay lifecycle. */
export const askStatusEnum = pgEnum("ask_status", [
  "queued",
  "routed",
  "answered",
]);

/**
 * Member invitation lifecycle (account-creating join link). DISTINCT from a link session
 * token: an invitation leads a NEW person to create an Account and join a family, whereas a
 * link session is a login-free capture identity (no Account required). See ADR-0001.
 */
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/**
 * Join-request lifecycle. A stranger who discovered a (discoverable) family asks its steward to
 * let them in; the steward approves (→ membership) or declines. Discovery never bypasses
 * steward consent — joining is always approval-gated. See ADR-0001.
 */
export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "declined",
]);

// ---------------------------------------------------------------------------
// Person — the spine. Permanent, singular, owner of everything expressive.
// A Person does NOT require a login: many Persons capture their stories through a login-free
// link session and never create an Account.
// ---------------------------------------------------------------------------

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    /** The name the interviewer should speak aloud. */
    spokenName: text("spoken_name").notNull(),
    birthYear: integer("birth_year"),
    /**
     * Full date of birth, captured during account onboarding (the one required step). Stored as
     * a calendar date (no time/zone). `birthYear` is kept alongside as the coarse anchor the
     * interviewer already reads; both are written together when onboarding captures a full date.
     */
    birthDate: date("birth_date"),
    /**
     * When this Person completed account onboarding. NULL = has not onboarded yet, which is
     * the gate the hub uses to route a fresh account into the welcome → DOB → doors flow. Persons
     * with no Account (e.g. those who only ever capture via a link session) never onboard and stay
     * NULL forever — they are never routed through the hub.
     */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    /** Lightly-held biographical anchors used to warm up the interviewer (place, etc.). */
    biographicalAnchors: jsonb("biographical_anchors")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    lifeStatus: lifeStatusEnum("life_status").notNull().default("living"),
    /**
     * Pointer to the Account that may control this Person, if any (null for the many login-free
     * Persons). UNIQUE so one Account maps to exactly one Person. This is the SINGLE source of
     * truth for the Person<->Account link (Account carries no back-pointer, avoiding divergence).
     * Postgres unique indexes permit many NULLs, so the many login-less Persons coexist freely.
     */
    accountId: uuid("account_id").references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("persons_account_id_uq").on(t.accountId)],
);

// ---------------------------------------------------------------------------
// Account — the OPTIONAL, severable login attached to some Persons.
// Holds only the auth provider's user id + basic profile. Nothing expressive
// hangs off the Account (so a death can deactivate it while the Person persists).
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The auth provider's opaque user id (Clerk, etc.). The app never stores passwords. */
    authProviderUserId: text("auth_provider_user_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_auth_provider_user_id_uq").on(t.authProviderUserId),
  ],
);

// ---------------------------------------------------------------------------
// Family (the Chronicle) — a container that owns NOTHING expressive. Stories are
// surfaced into it, never stored in it.
// ---------------------------------------------------------------------------

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * Optional free-text description of the family ("the Espositos from Naples, bakers for three
   * generations"). Feeds the natural-language/keyword family search. Only consulted for families
   * that have opted into discovery.
   */
  description: text("description"),
  /**
   * Opt-in discovery flag. A stranger's search NEVER returns a family with `discoverable = false`,
   * and even when true the search exposes only family name + steward display name — never members
   * or stories. Joining a discovered family is always steward-approved (a join_request). Default
   * false keeps the privacy-first posture: families are private until the steward opts in. ADR-0001.
   */
  discoverable: boolean("discoverable").notNull().default(false),
  creatorPersonId: uuid("creator_person_id")
    .notNull()
    .references(() => persons.id),
  /** Phase 0: set to the creator. Seam for the Phase 4 steward console + succession. */
  stewardPersonId: uuid("steward_person_id")
    .notNull()
    .references(() => persons.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Membership — the plural, revocable link between a Person and a Family.
// Carries role + status. Inputs to EVERY permission check.
// ---------------------------------------------------------------------------

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    role: membershipRoleEnum("role").notNull().default("member"),
    status: membershipStatusEnum("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memberships_person_idx").on(t.personId),
    index("memberships_family_idx").on(t.familyId),
    // At most one ACTIVE membership per (person, family). Ended/paused rows may coexist,
    // so a person can leave and rejoin without violating this. (Partial unique index added
    // in the triggers migration — drizzle-kit does not model partial indexes here.)
  ],
);

// ---------------------------------------------------------------------------
// Media — any binary asset. Owned by the Person, lives in object storage (keys, not blobs),
// and is IMMUTABLE (never updated or deleted — new versions are new rows). The media
// immutability trigger structurally protects the canonical recording.
// ---------------------------------------------------------------------------

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => persons.id),
    kind: mediaKindEnum("kind").notNull(),
    /** Object-storage key/URL. The table stores keys, never blobs. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    /** For audio. */
    durationSeconds: integer("duration_seconds"),
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("media_owner_idx").on(t.ownerPersonId)],
);

// ---------------------------------------------------------------------------
// Story — the unit of narrative. Owned by exactly one Person. Points to its canonical
// Recording (required). NEVER duplicated per family — there is no story<->family table.
// ---------------------------------------------------------------------------

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => persons.id),
    state: storyStateEnum("state").notNull().default("draft"),
    /** The visibility dial. Defaults to private — where every story stays until approval. */
    audienceTier: audienceTierEnum("audience_tier").notNull().default("private"),
    /**
     * The canonical Recording (original audio). REQUIRED — the model encodes that audio is
     * the source of truth. Media is created first, then the Story points at it.
     */
    recordingMediaId: uuid("recording_media_id")
      .notNull()
      .references(() => media.id),
    // --- derived, regenerable fields (subordinate to the audio) ---
    transcript: text("transcript"),
    /** Word-level timing from the transcriber, mapped back to 1x time (seam for sync playback). */
    transcriptWordTimings: jsonb("transcript_word_timings").$type<
      Array<{ word: string; startMs: number; endMs: number }>
    >(),
    prose: text("prose"),
    title: text("title"),
    summary: text("summary"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`),
    /** The representative year the story is ABOUT (historical era), not when it was recorded. */
    eraYear: integer("era_year"),
    /** Optional human display note for the era/place, e.g. "Naples" or "Cherry Street". */
    eraLabel: text("era_label"),
    // --- provenance ---
    /** The question that prompted this story. */
    promptQuestion: text("prompt_question"),
    /** If it came from a family member's ask, a pointer to that Ask. */
    askId: uuid("ask_id"),
    // --- lifecycle ---
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stories_owner_idx").on(t.ownerPersonId),
    index("stories_state_idx").on(t.state),
  ],
);

// ---------------------------------------------------------------------------
// ConsentRecord — the append-only consent ledger. Each row is an immutable event.
// Revocation is a NEW row that supersedes a prior one (enforced by trigger).
// ---------------------------------------------------------------------------

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic total order over events — makes "latest consent wins" deterministic even
     * when two records share a timestamp. The ledger is a sequence of events, so it has one. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** Who consented. */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** What about — a Story (usual case)... */
    storyId: uuid("story_id").references(() => stories.id),
    /** ...or a broader scope (e.g. a membership) when not story-specific. */
    scope: text("scope"),
    action: consentActionEnum("action").notNull(),
    /** The resulting state (e.g. the tier set, or the story state reached). */
    resultingState: text("resulting_state").notNull(),
    /** Pointer to the approval-audio Media — so consent has a voice, not just a row. */
    approvalAudioMediaId: uuid("approval_audio_media_id").references(
      () => media.id,
    ),
    /** The actor who recorded the event (the narrator, for a voice approval). */
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("consent_person_idx").on(t.personId),
    index("consent_story_idx").on(t.storyId),
  ],
);

// ---------------------------------------------------------------------------
// Ask — the self-feeding relay. A family member's question for a narrator, which becomes
// the narrator's next prompt and, once answered+approved, the family's notification.
// An Ask is a prompt, not expressive content — it is not owned by a Family.
// ---------------------------------------------------------------------------

export const asks = pgTable(
  "asks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askerPersonId: uuid("asker_person_id")
      .notNull()
      .references(() => persons.id),
    /** The target narrator. */
    targetPersonId: uuid("target_person_id")
      .notNull()
      .references(() => persons.id),
    /** The family context the ask was raised in (for routing/notification). Nullable. */
    familyId: uuid("family_id").references(() => families.id),
    questionText: text("question_text").notNull(),
    status: askStatusEnum("status").notNull().default("queued"),
    /** The resulting Story once answered. */
    storyId: uuid("story_id").references(() => stories.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    routedAt: timestamp("routed_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("asks_target_idx").on(t.targetPersonId),
    index("asks_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Link sessions — a login-free, token-based capture entry (Phase 1 capture path). The long,
// unguessable token IS the identity for the duration of the session; it is bound to one Person
// (the narrator the link captures for) but assumes nothing about who they are or how they record.
// Stored hashed. (Defined here so the schema is the one source of truth; used from increment 2 on.)
// ---------------------------------------------------------------------------

export const linkSessions = pgTable(
  "link_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the long unguessable token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    /** The Person (narrator) this link speaks for. */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** The inviting family context. */
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    /** Who generated the invite. */
    invitedByPersonId: uuid("invited_by_person_id")
      .notNull()
      .references(() => persons.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("link_sessions_token_hash_uq").on(t.tokenHash),
    index("link_sessions_person_idx").on(t.personId),
  ],
);

// ---------------------------------------------------------------------------
// Invitation — the account-creating member invite (distinct from link_sessions).
// A person follows the link, signs up, and joins `familyId`. The invite carries the payload the
// onboarding "welcome" screen renders (inviter, family, name, relation).
// Stored hashed like link sessions: the raw token is never persisted. ADR-0001.
// ---------------------------------------------------------------------------

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the long unguessable token. The raw token lives only in the emailed link. */
    tokenHash: text("token_hash").notNull(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    /** Who sent the invite. */
    inviterPersonId: uuid("inviter_person_id")
      .notNull()
      .references(() => persons.id),
    /** Pre-filled invitee display name from the inviter ("Salvatore Esposito"). */
    inviteeName: text("invitee_name"),
    /** Optional email the invite was addressed to (the person may be unknown to the system). */
    inviteeEmail: text("invitee_email"),
    /** Free-text relationship label shown on the welcome screen ("Rosa's father"); editable there. */
    relationshipLabel: text("relationship_label"),
    /** Role the invitee receives on acceptance. Defaults to `member` (no age-based roles in UI). */
    role: membershipRoleEnum("role").notNull().default("member"),
    status: invitationStatusEnum("status").notNull().default("pending"),
    /** The Person created/linked when the invite was accepted. */
    acceptedPersonId: uuid("accepted_person_id").references(() => persons.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    index("invitations_family_idx").on(t.familyId),
  ],
);

// ---------------------------------------------------------------------------
// JoinRequest — a stranger's approval-gated request to join a discoverable family.
// Discovery surfaces the family; this row is the steward's consent gate. Approval creates a
// Membership (never bypassed). Decline closes it. ADR-0001.
// ---------------------------------------------------------------------------

export const joinRequests = pgTable(
  "join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    /** The person asking to join (already has an Account — they signed up first). */
    requesterPersonId: uuid("requester_person_id")
      .notNull()
      .references(() => persons.id),
    /** Optional note to the steward ("I'm Rosa's cousin from Naples"). */
    message: text("message"),
    status: joinRequestStatusEnum("status").notNull().default("pending"),
    /** The steward (or other member) who approved/declined. */
    decidedByPersonId: uuid("decided_by_person_id").references(
      () => persons.id,
    ),
    /** The Membership created on approval (null while pending or if declined). */
    resultingMembershipId: uuid("resulting_membership_id").references(
      () => memberships.id,
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("join_requests_family_idx").on(t.familyId),
    index("join_requests_requester_idx").on(t.requesterPersonId),
    index("join_requests_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// MockAuthUser — DEV/TEST ONLY. Simulates the bought auth provider's (Clerk's) own user store.
//
// The architecture rule (spec Part IV) is that an Account stores ONLY the provider's opaque user
// id and NEVER a password. The real provider (Clerk) owns credentials. To exercise real signup /
// signin locally without standing up Clerk, this table plays Clerk's role: it holds the
// email+password the provider would hold, keyed to the `authProviderUserId` that lands on the
// Account. PRODUCTION never reads or writes this table — `isClerkConfigured()` swaps it out.
// ---------------------------------------------------------------------------

export const mockAuthUsers = pgTable(
  "mock_auth_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** Salted hash — even the mock provider never stores a plaintext password. */
    passwordHash: text("password_hash").notNull(),
    /** The opaque id handed to the Account as `auth_provider_user_id` (this provider's user id). */
    authProviderUserId: text("auth_provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mock_auth_users_email_uq").on(t.email),
    uniqueIndex("mock_auth_users_provider_id_uq").on(t.authProviderUserId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred types — the shared contracts other packages import.
// ---------------------------------------------------------------------------

export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
export type Ask = typeof asks.$inferSelect;
export type NewAsk = typeof asks.$inferInsert;
export type LinkSession = typeof linkSessions.$inferSelect;
export type NewLinkSession = typeof linkSessions.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type JoinRequest = typeof joinRequests.$inferSelect;
export type NewJoinRequest = typeof joinRequests.$inferInsert;
export type MockAuthUser = typeof mockAuthUsers.$inferSelect;
export type NewMockAuthUser = typeof mockAuthUsers.$inferInsert;

export type LifeStatus = (typeof lifeStatusEnum.enumValues)[number];
export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
export type MembershipStatus = (typeof membershipStatusEnum.enumValues)[number];
export type StoryState = (typeof storyStateEnum.enumValues)[number];
export type AudienceTier = (typeof audienceTierEnum.enumValues)[number];
export type MediaKind = (typeof mediaKindEnum.enumValues)[number];
export type ConsentAction = (typeof consentActionEnum.enumValues)[number];
export type AskStatus = (typeof askStatusEnum.enumValues)[number];
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];
export type JoinRequestStatus =
  (typeof joinRequestStatusEnum.enumValues)[number];
