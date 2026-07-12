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
 *   - The canonical Recording (audio Media), when present, is immutable and undetachable while its
 *     Story lives (removed only when the Story itself is deleted; ADR-0008).
 *   - The consent ledger is append-only (revocation = a new superseding row).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type {
  FollowUpCandidate,
  CandidateDisposition,
  FollowUpPolicy,
} from "./follow-up-types";

// ---------------------------------------------------------------------------
// Enums — the shared vocabulary of states/tiers/roles (Part II)
// ---------------------------------------------------------------------------

/** Gates posthumous behavior downstream (story-will, time-gated release — seams). */
export const lifeStatusEnum = pgEnum("life_status", ["living", "deceased"]);

/**
 * ADR-0016: WHY a `persons` row was created — its provenance. IMMUTABLE (never flips): a `mention`
 * later invited keeps `origin = mention`; current state lives in `accountId`/`memberships`/`lifeStatus`.
 *   - `self`    — a real person acting for themselves (the origin of every pre-kinship Person).
 *   - `invitee` — a provisional Account-less Person minted to anchor an invitation (ADR-0006).
 *                 The housekeeping reaper keys off THIS origin (unaccepted → reapable).
 *   - `mention` — named as kin (may never be contacted, may be deceased, may be a structural bridge).
 *                 NEVER reaped: a deceased ancestor or an anonymous bridge node must persist forever.
 */
export const personOriginEnum = pgEnum("person_origin", ["self", "invitee", "mention"]);

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

/** Two-kind ledger: a `decision` row (candidates + dispositions + phrased line) and an
 * `outcome` row (what the narrator did), the latter referencing the former. Mirrors the
 * consent ledger's append + superseding-append shape. */
export const followUpRecordKindEnum = pgEnum("follow_up_record_kind", ["decision", "outcome"]);

/** What the narrator did with an asked follow-up. */
export const followUpOutcomeEnum = pgEnum("follow_up_outcome", ["answered", "skipped", "off_ramped"]);

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

/** photo/document are seams for later media kinds; Phase 1 uses the audio kinds. */
export const mediaKindEnum = pgEnum("media_kind", [
  "story_audio",
  "approval_audio",
  "intake_audio",
  "caption_audio", // ADR-0008: audio of a voice caption on a photo
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

/** ADR-0007: a Story is origin-typed. `voice` has a canonical audio recording; `text` is typed
 * (the words are canonical, no recording). Audio is the source of truth ONLY when present. */
export const storyKindEnum = pgEnum("story_kind", ["voice", "text"]);

/**
 * The provenance levels of a story's prose, oldest to newest. `user_authored` is the origin level
 * for a typed (text-origin) story — the person's own words, predating any AI step. `ai_cleaned` is
 * the AUTOMATIC per-take Cleanup pass (filler / false-starts / within-take self-corrections;
 * ADR-0014 §2). `ai_polished` is the MANUAL, human-confirmed holistic Polish button — a distinct,
 * opt-in operation (nothing writes it automatically). `ai_verified` is a reserved future seam (an
 * AI verify/judge step) — not produced by Phase 1.
 */
export const proseRevisionLevelEnum = pgEnum("prose_revision_level", [
  "user_authored",
  "ai_transcribed",
  "ai_cleaned",
  "ai_polished",
  "human_corrected",
  "ai_verified",
  "human_metadata_edit",
]);

// ---------------------------------------------------------------------------
// BiographicalProfile — compile-time type for persons.biographical_anchors (JSONB).
// ---------------------------------------------------------------------------

/**
 * Named biographical facts collected by the EPHEMERAL intake pass and inferred from approved
 * stories. Stored in `persons.biographical_anchors` (JSONB). All fields nullable — null means
 * "not yet known". The picker checks these to decide which intake questions remain. Story
 * extraction never overwrites a non-null value.
 */
export interface BiographicalProfile {
  hometown: string | null;
  siblingContext: string | null;
  currentLocation: string | null;
  occupationSummary: string | null;
  hasChildren: boolean | null;
  hasGrandchildren: boolean | null;
}

// ---------------------------------------------------------------------------
// Person — the spine. Permanent, singular, owner of everything expressive.
// A Person does NOT require a login: many Persons capture their stories through a login-free
// link session and never create an Account.
// ---------------------------------------------------------------------------

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The person's identity name. NULLABLE (ADR-0016): a deliberately anonymous bridge node
     * (`origin = mention`, `identified = false`) carries no name and is rendered from the relation
     * ("your father"). Every named Person — every `self`, and any identified mention — has one.
     */
    displayName: text("display_name"),
    /**
     * The name the interviewer should speak aloud. NULLABLE for the same reason as `displayName`:
     * a nameless placeholder mention (never interviewed) has no spoken name. Named Persons always
     * carry one (derived from `displayName` on create; see `defaultSpokenName`).
     */
    spokenName: text("spoken_name"),
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
      .$type<Partial<BiographicalProfile>>()
      .default(sql`'{}'::jsonb`),
    lifeStatus: lifeStatusEnum("life_status").notNull().default("living"),
    /**
     * ADR-0016: provenance. Immutable. Defaults to `self` so every existing row backfills to `self`
     * and any Person minted without an explicit origin (a real actor) is correctly `self`. The
     * invitation + kinship write paths set `invitee` / `mention` explicitly.
     */
    origin: personOriginEnum("origin").notNull().default("self"),
    /**
     * ADR-0016: `true` (default) when this Person has a real, typed identity; `false` only for a
     * deliberately anonymous bridge node (a placeholder `mention` that exists solely to connect
     * non-adjacent kin). Filling in the name flips this to `true` (origin unchanged). Chosen over
     * inferring anonymity from a null name because *deliberately unknown* and *not-yet-typed* are
     * different intents that drive different UI/reconciliation behavior.
     */
    identified: boolean("identified").notNull().default(true),
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
// and is immutable and undetachable while its item lives: never updated, and never deleted or
// detached on its own — new versions are new rows, and content audio is removed only when the
// item it belongs to is itself deleted (ADR-0008). The media guard trigger enforces this.
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
// IntakeAnswer — a durable, PRIVATE biographical intake answer (voice- or text-origin).
// NOT a Story (the intake/story wall is preserved): it is owner-only, never shared, and feeds
// persons.biographical_anchors. A member may later promote one into a Story (follow-up, not built
// here). `text` is the saved answer — an edited transcript OR typed text. `text` is mutable (the
// user edits it); there is no append-only trigger on this table.
// ---------------------------------------------------------------------------

export const intakeOriginEnum = pgEnum("intake_origin", ["voice", "typed"]);

export const intakeAnswers = pgTable(
  "intake_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** A `keyof BiographicalProfile` (e.g. "hometown"). Stored as text — the app owns the enum. */
    questionKey: text("question_key").notNull(),
    /** The verbatim question text shown to the narrator, snapshotted for durability. */
    promptQuestion: text("prompt_question").notNull(),
    origin: intakeOriginEnum("origin").notNull(),
    /** The kept audio (kind=intake_audio). NULL for a typed answer. */
    mediaId: uuid("media_id").references(() => media.id),
    /** Raw ASR output. NULL for a typed answer. */
    transcript: text("transcript"),
    /** The saved answer: edited transcript OR typed text. Empty string until transcription seeds it. */
    text: text("text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("intake_answers_person_idx").on(t.personId),
    uniqueIndex("intake_answers_person_question_uq").on(t.personId, t.questionKey),
  ],
);

// ---------------------------------------------------------------------------
// IntakeRevision — append-only edit-history of an intake answer's text at each stage, mirroring the
// SHAPE and trigger of prose_revisions but a SEPARATE table (ADR-0014 §8: the intake/story wall is
// preserved — intake is NOT a Story, so its lineage is not a polymorphic widening of prose_revisions,
// which lives behind the content wall). Owner-only, never shared; lives in the MAIN schema like
// intake_answers. Reuses proseRevisionLevelEnum verbatim. Immutable: a trigger (invariants.sql)
// forbids UPDATE. DELETE stays permitted so the FK cascade reclaims revisions on owner erasure
// (intake is never consented — there is no consent-scoped delete guard).
// ---------------------------------------------------------------------------

export const intakeRevisions = pgTable(
  "intake_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic global sequence — deterministic per-answer ordering even under equal timestamps. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    intakeAnswerId: uuid("intake_answer_id")
      .notNull()
      .references(() => intakeAnswers.id, { onDelete: "cascade" }),
    level: proseRevisionLevelEnum("level").notNull(), // reuse the story enum verbatim
    /** The answer text at this stage. */
    text: text("text").notNull(),
    /** AI model that produced this level; null for human_corrected. */
    modelId: text("model_id"),
    /** Exact prompt that produced this level; null for ai_transcribed (STT) and human_corrected. */
    promptText: text("prompt_text"),
    /** The person who produced a human_corrected revision; null for AI levels. */
    actorPersonId: uuid("actor_person_id").references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intake_revisions_answer_idx").on(t.intakeAnswerId)],
);

// ---------------------------------------------------------------------------
// Story — the unit of narrative. Owned by exactly one Person. Points to its canonical
// Recording (required). A Story is a SINGLE row, never copied per family; which of the owner's
// families a `family`/`branch`-tier Story is surfaced into is a many-to-many recorded in
// `story_families` (ADR-0010), NOT a per-family duplicate of the Story.
// ---------------------------------------------------------------------------

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => persons.id),
    state: storyStateEnum("state").notNull().default("draft"),
    /** ADR-0007: origin type. voice ⇒ has a canonical recording; text ⇒ typed, no recording. */
    kind: storyKindEnum("kind").notNull().default("voice"),
    /** The visibility dial. Defaults to private — where every story stays until approval. */
    audienceTier: audienceTierEnum("audience_tier").notNull().default("private"),
    /**
     * The canonical Recording (original audio). Present iff kind = 'voice' (ADR-0007; enforced by a
     * DB CHECK in invariants.sql). Media is created first, then the Story points at it.
     */
    recordingMediaId: uuid("recording_media_id").references(() => media.id),
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
    /**
     * The family the recording was CAPTURED FOR — the originating family context (ADR-0010). Set
     * from the link-session's `familyId` (NOT NULL there) at draft creation; nullable because the
     * in-hub account capture path carries no session family. Drives approval-time DEFAULT family
     * targeting (`story_families`) so a family/branch story is surfaced into the family it was told
     * for without the narrator having to pick. NOT the visibility set itself — that is `story_families`.
     */
    originatingFamilyId: uuid("originating_family_id").references(() => families.id),
    /**
     * The album photo this story is ABOUT (ADR-0009 Phase 3 "subject"). Nullable, ≤1 — the thin
     * "what this is about" pointer. NO cascade: a story stays semantically about a soft-deleted
     * photo (its bytes 404 via the existing soft-delete filter). Forward FK to `family_photos`
     * (defined later in this file) via the AnyPgColumn arrow, mirroring proseRevisions.storyRecordingId.
     * At creation this photo is ALSO inserted as the story's FIRST `story_images` cover row (atomic),
     * so the subject rides on `getStoryForViewer`'s row and needs no new read arm.
     */
    subjectPhotoId: uuid("subject_photo_id").references(
      (): AnyPgColumn => familyPhotos.id,
    ),
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
// StoryFamily — the story→family targeting set (Mode 4, ADR-0010). The many-to-many that scopes
// which of the owner's families a `family`/`branch`-tier Story is surfaced into. The Story stays a
// SINGLE row owned by one Person (never duplicated per family); this table is a visibility-scoping
// set, not a per-family copy. It is an AUTHZ INPUT (like `memberships`/`consentRecords`), NOT
// Story content — so it lives in the OPEN schema, freely importable, not behind the /content guard.
// `family`/`branch` visibility = targetFamilies ∩ owner-active-families ∩ viewer-active-families.
// Empty target set ⇒ the story is visible to the OWNER ONLY (deliberately no "all families"
// fallback — that would reintroduce the over-share ADR-0010 exists to prevent).
// ---------------------------------------------------------------------------

export const storyFamilies = pgTable(
  "story_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A story is targeted to a given family at most once.
    uniqueIndex("story_families_story_family_uq").on(t.storyId, t.familyId),
    index("story_families_story_idx").on(t.storyId),
    index("story_families_family_idx").on(t.familyId),
  ],
);

// ---------------------------------------------------------------------------
// ProseRevision — append-only provenance of a story's prose at each stage
// (L1 raw transcript → L2 AI-polished → L3 human-corrected). Holds prose CONTENT,
// so the table object lives behind @chronicle/db/content. Immutable: a trigger
// (invariants.sql) forbids UPDATE/DELETE. The L2→L3 diff is the prompt/model signal;
// modelId + promptText record exactly what produced each AI level.
// ---------------------------------------------------------------------------

export const proseRevisions = pgTable(
  "prose_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic global sequence — provides deterministic per-story ordering even when two
     * rows share a created_at timestamp. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    level: proseRevisionLevelEnum("level").notNull(),
    /** The prose text at this stage. */
    text: text("text").notNull(),
    /** AI model that produced this level; null for human_corrected. */
    modelId: text("model_id"),
    /** Exact prompt that produced this level; null for ai_transcribed (STT) and human_corrected. */
    promptText: text("prompt_text"),
    /** The person who produced a human_corrected revision; null for AI levels. */
    actorPersonId: uuid("actor_person_id").references(() => persons.id),
    /**
     * ADR-0014 §2: the audio take this row derives from, for PER-TAKE automatic levels
     * (ai_transcribed / ai_cleaned). NULL for holistic rows (ai_polished, human_corrected) and
     * for typed takes (user_authored). A nullable FK — "not tied to one audio take".
     */
    storyRecordingId: uuid("story_recording_id").references(
      (): AnyPgColumn => storyRecordings.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prose_revisions_story_idx").on(t.storyId)],
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
// StoryRecording — an ordered take within a Story (ADR-0012). Position 0 is the initial
// answer; 1,2,... are follow-up takes, each with its own immutable Media (kind=story_audio)
// and derived transcript. Holds transcript CONTENT, so the table object lives behind
// @chronicle/db/content. Takes are freely droppable pre-approval; once the owning Story has a
// consent record they are frozen (invariants.sql delete-guard) — the ordered take set becomes
// part of the audit trail, just like the canonical recording itself.
// ---------------------------------------------------------------------------

export const storyRecordings = pgTable(
  "story_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id").notNull().references(() => stories.id),
    /** 0-based take order within the story. 0 = the initial answer; 1,2,… = follow-up takes. */
    position: integer("position").notNull(),
    /** The immutable Media (kind=story_audio) for THIS take. */
    mediaId: uuid("media_id").notNull().references(() => media.id),
    /** Raw ASR output for this take. Null until the transcribe step fills it. */
    transcript: text("transcript"),
    /** Word-level timing for this take (seam for sync playback), 1x time. */
    transcriptWordTimings: jsonb("transcript_word_timings").$type<
      Array<{ word: string; startMs: number; endMs: number }>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("story_recordings_story_idx").on(t.storyId),
    uniqueIndex("story_recordings_story_position_uq").on(t.storyId, t.position),
  ],
);

// ---------------------------------------------------------------------------
// FollowUpDecision — the append-only narrator-AI follow-up ledger (ADR-0013). Each turn writes
// a `decision` row (candidates + dispositions + the phrased line the narrator heard), then a
// later `outcome` row references it (what the narrator did). Mirrors the consent ledger's
// append + superseding-append shape — an outcome is a NEW row, never an edit of the decision.
// ---------------------------------------------------------------------------

export const followUpDecisions = pgTable(
  "follow_up_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic total order — deterministic "latest decision" even under same-timestamp rows. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    storyId: uuid("story_id").notNull().references(() => stories.id),
    /** 0-based follow-up turn index within the thread (0 = evaluation after the initial answer). */
    threadPosition: integer("thread_position").notNull(),
    recordKind: followUpRecordKindEnum("record_kind").notNull(),
    // --- decision rows (null on outcome rows) ---
    evaluatorModelId: text("evaluator_model_id"),
    candidates: jsonb("candidates").$type<FollowUpCandidate[]>(),
    dispositions: jsonb("dispositions").$type<CandidateDisposition[]>(),
    /** The chosen threadSeed, or null when nothing was selected (thread ends). */
    selectedSeed: text("selected_seed"),
    /** The line the narrator actually heard, or null when nothing was selected. */
    phrasedLine: text("phrased_line"),
    /** Snapshot of the resolved policy that governed this turn (audit/replay). */
    policy: jsonb("policy").$type<FollowUpPolicy>(),
    // --- outcome rows (null on decision rows) ---
    /** Self-FK: the decision row this outcome resolves. Null on decision rows. */
    decisionId: uuid("decision_id").references((): AnyPgColumn => followUpDecisions.id),
    outcome: followUpOutcomeEnum("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("follow_up_decisions_story_idx").on(t.storyId)],
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
    // The family context(s) the ask is raised in (for routing/notification) now live in the
    // `ask_families` M2M join table (mirrors `story_families`) — an ask may target one-or-more
    // families. The former single nullable `family_id` column has been removed.
    questionText: text("question_text").notNull(),
    /** ADR-0008: present iff the question was asked by voice; the referenced media is a
     *  protected content artifact (un-detachable while this ask lives, cascades on ask delete). */
    recordingMediaId: uuid("recording_media_id").references(() => media.id),
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
// AskFamily — the family context(s) an Ask is raised in (M2M), mirroring `story_families`.
// An ask may target one-or-more families for routing/notification. Like `story_families`, this is
// a routing/visibility-scoping SET (an AUTHZ/routing INPUT), not content — it lives on the OPEN
// schema surface, freely importable. Empty set ⇒ an ask with no family context.
// ---------------------------------------------------------------------------

export const askFamilies = pgTable(
  "ask_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => asks.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // An ask is targeted to a given family at most once.
    uniqueIndex("ask_families_ask_family_uq").on(t.askId, t.familyId),
    index("ask_families_ask_idx").on(t.askId),
    index("ask_families_family_idx").on(t.familyId),
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
    /**
     * The provisional (Account-less) Person this invite anchors to (ADR-0006). Created up front by
     * `createInvitation` so an Ask can target a pending invitee before they join. On acceptance the
     * provisional Person is MERGED into the accepting Person and this column is re-pointed to it
     * (queued Asks are moved over, the provisional row deleted) — so it always names a real anchor.
     */
    inviteePersonId: uuid("invitee_person_id")
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
// GooglePhotosConnection — ADR-0009 Phase 5. Connect-once OAuth vault for Google Photos Picker.
// OPEN schema (like link_sessions / mock_auth_users): stores an encrypted refresh token per Person,
// not Story/Media content. Access tokens are minted on demand and never persisted. Disconnect sets
// `revokedAt` (or deletes the row) and best-effort revokes at Google.
// ---------------------------------------------------------------------------

export const googlePhotosConnections = pgTable("google_photos_connections", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => persons.id),
  /** AES-256-GCM ciphertext of the OAuth refresh token (never plaintext at rest). */
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  /** Optional Google account email from the token exchange (display / audit only). */
  googleAccountEmail: text("google_account_email"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Soft-revoke marker; a non-null value means the connection is inactive. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// StoryView — per-viewer read state. NOT Story content (it exposes nothing about a story beyond
// "this person has opened it"), so it lives in the public schema, not behind the /content guard.
// One row the first time a viewer opens a story; the unique index makes the open idempotent.
// Drives the "New" badge: a story is new to a viewer until a row exists for them.
// ---------------------------------------------------------------------------

export const storyViews = pgTable(
  "story_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The story that was viewed. */
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    /** The viewer (the account-person who opened it). */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("story_views_story_person_uq").on(t.storyId, t.personId),
    index("story_views_person_idx").on(t.personId),
  ],
);

export const storyFavorites = pgTable(
  "story_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("story_favorites_story_person_uq").on(t.storyId, t.personId),
    index("story_favorites_person_idx").on(t.personId),
  ],
);

export const storyLikes = pgTable(
  "story_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("story_likes_story_person_uq").on(t.storyId, t.personId),
    index("story_likes_person_idx").on(t.personId),
  ],
);


// ---------------------------------------------------------------------------
// FamilyPhoto (the album) — ADR-0009. A photo is a CONTRIBUTED-not-owned artifact that lands in
// one or more Family albums. Kept SEPARATE from `media` on lifecycle grounds: a photo lives
// independently, attaches to many items (many-to-many), and is deletable on its own (soft-delete
// via `deletedAt`); audio is a single-owner, immutable child of one item. Photo BYTES are
// write-once in object storage (`storageKey` UNIQUE — no silent pixel-swap); the ROW is deletable
// by the contributor or steward (ADR-0008). NOT under the media immutability trigger. Holds
// contributed CONTENT, so the table object lives behind @chronicle/db/content and only the audited
// `album-repository.ts` touches it (mirrors stories/media).
// ---------------------------------------------------------------------------

/** How a photo entered the album — provenance only ("import, not sync", ADR-0009). */
export const photoSourceEnum = pgEnum("photo_source", ["upload", "google_picker"]);

export const familyPhotos = pgTable(
  "family_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The contributor (a photo has a CONTRIBUTOR, not an owner — ADR-0009). */
    contributorPersonId: uuid("contributor_person_id")
      .notNull()
      .references(() => persons.id),
    source: photoSourceEnum("source").notNull(),
    /** Object-storage key (`family-photos/<uuid>`). Write-once; UNIQUE so bytes never silently swap. */
    storageKey: text("storage_key").notNull().unique(),
    /** Contributor-authored free-text label; mutable, last-write-wins, off every ledger; alt text. */
    caption: text("caption"),
    /** EXIF capture time. Populated by #17; NULL in #15 (schema column is the shared contract). */
    exifCapturedAt: timestamp("exif_captured_at", { withTimezone: true }),
    /** EXIF GPS `{lat,lng}`. Populated by #17; NULL in #15. */
    exifGps: jsonb("exif_gps").$type<{ lat: number; lng: number }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-delete: a non-null value ⇒ the photo is treated as ABSENT everywhere. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("family_photos_contributor_idx").on(t.contributorPersonId)],
);

/**
 * ADR-0008: a VOICE caption on a photo — distinct from the mutable, off-ledger `family_photos.caption`
 * text. The audio (`mediaId`, kind `caption_audio`) is a protected content artifact: un-detachable
 * while this row lives, cascaded away when the photo is deleted. `transcript` is the words the audio
 * was transcribed to; the audio is always the source of truth.
 */
export const voiceCaptions = pgTable(
  "voice_captions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => familyPhotos.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id),
    transcript: text("transcript"),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("voice_captions_photo_idx").on(t.photoId)],
);

// ---------------------------------------------------------------------------
// FamilyPhotoFamily — album membership (M2M). "Being in a family's album IS the contributor's
// consent for that family to see it" (ADR-0009), mirroring story_families' multi-family targeting.
// Composite PK (photo_id, family_id); ON DELETE CASCADE so deleting the photo row un-attaches it
// from every album at once. Also guarded (behind @chronicle/db/content) — only album-repository.ts
// reads/writes it, since it IS the album's authorization input.
// ---------------------------------------------------------------------------

export const familyPhotoFamilies = pgTable(
  "family_photo_families",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => familyPhotos.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.photoId, t.familyId] }),
    index("family_photo_families_family_idx").on(t.familyId),
  ],
);

// ---------------------------------------------------------------------------
// StoryImage (accompaniment) — ADR-0009. Pictures shown ALONGSIDE a Story to illustrate it: many
// per story, exactly one COVER, ordered by `position`. This is the ONLY rendering path for a
// story's imagery ("all rendering flows through story_images"). A row is EITHER an album photo
// (`familyPhotoId` set, `provenance = 'family_photo'`) OR an inline illustration (`familyPhotoId`
// NULL, the reserved `sourceUrl`/`license`/... fields carry it — Phase 2 writes only family_photo).
// Holds attachment CONTENT (a `private` story must not leak its imagery — ADR-0009 authz), so the
// table object lives behind @chronicle/db/content and only the audited `story-image-repository.ts`
// (and, for the broadened photo-byte read seam, `album-repository.ts`) touches it.
// ---------------------------------------------------------------------------

/** How a story image was sourced (ADR-0009 accompaniment). */
export const storyImageProvenanceEnum = pgEnum("story_image_provenance", [
  "family_photo",
  "illustration",
]);

export const storyImages = pgTable(
  "story_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // FK to stories with NO cascade — mirrors story_families; discardDraftStory deletes children first.
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    // The album photo shown. NULL for an inline illustration. Cascade so a HARD photo-row delete
    // un-attaches everywhere (album delete is SOFT → cascade won't fire → the READ seam treats a
    // soft-deleted photo as absent; see the album-repository read rule).
    familyPhotoId: uuid("family_photo_id").references(() => familyPhotos.id, {
      onDelete: "cascade",
    }),
    provenance: storyImageProvenanceEnum("provenance")
      .notNull()
      .default("family_photo"),
    // Reserved inline-illustration fields (ADR-0009) — all NULL for family_photo provenance in Phase 2.
    sourceUrl: text("source_url"),
    license: text("license"),
    attribution: text("attribution"),
    thumbnailUrl: text("thumbnail_url"),
    isCover: boolean("is_cover").notNull().default(false),
    position: integer("position").notNull(), // 0-based order within the story
    attachedByPersonId: uuid("attached_by_person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("story_images_story_idx").on(t.storyId),
    uniqueIndex("story_images_story_position_uq").on(t.storyId, t.position),
    // A given album photo attaches to a story at most once. NULL familyPhotoId (illustrations) are
    // distinct in Postgres, so multiple illustrations per story are allowed.
    uniqueIndex("story_images_story_photo_uq").on(t.storyId, t.familyPhotoId),
  ],
);

// ---------------------------------------------------------------------------
// AskSubjectPhoto — the Ask→subject-photo targeting set (ADR-0009 Phase 3). The photos an Ask is
// "about": a relative asks "tell the story of THIS photo" (one or more). Mirrors `story_families`'s
// role — a targeting/relationship set, NOT expressive content — so it lives on the OPEN schema
// (freely importable, NOT behind the /content guard). Composite PK (ask_id, photo_id) makes the same
// photo attach to an Ask at most once; both FKs CASCADE so deleting the Ask (or a HARD photo-row
// delete) clears the rows. Placed after `asks`/`familyPhotos` so both FKs resolve without a forward
// reference.
//
// ADR-COMMENT (Phase 3 authz, deliberate): there is NO dedicated read-seam arm for ask photos this
// slice. Their bytes rely on album-membership visibility (Arm 1 of `decideAlbumPhotoRead`): an Ask is
// created within a shared ACTIVE family and every subject photo is one the asker can already see
// (enforced by `assertPersonCanAccessAlbumPhoto` at createAsk), so a target co-member — who shares
// that active family — can also see it via the album read model. If a future flow lets an asker
// target a photo a co-member cannot otherwise see, add an accompaniment-style arm then.
// ---------------------------------------------------------------------------

export const askSubjectPhotos = pgTable(
  "ask_subject_photos",
  {
    /**
     * Monotonic global sequence — the DETERMINISTIC order key (mirrors proseRevisions.seq /
     * consentRecords.seq). `added_at` is `defaultNow()`, which in Postgres is the TRANSACTION-START
     * timestamp, so every row of a single bulk INSERT ties on it; ordering by `added_at` would then
     * be unspecified. Slice B treats position 0 of `listAskSubjectPhotos` as the story's cover/subject
     * photo, so a stable insertion-consistent order is load-bearing — hence this column, ordered asc.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => familyPhotos.id, { onDelete: "cascade" }),
    /** Audit timestamp (transaction-start; NOT a tiebreaker — see `seq`). */
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.askId, t.photoId] }),
    index("ask_subject_photos_photo_idx").on(t.photoId),
  ],
);

// ---------------------------------------------------------------------------
// ErasureAudit — ADR-0008. The append-only record that a deletion happened, outliving the erased
// content (story/ask/voice_caption + its audio + its consent ledger are hard-deleted).
// ---------------------------------------------------------------------------

/**
 * ADR-0008 erasure audit: the append-only record that a deletion happened. Outlives the erased
 * content (story/ask/voice_caption + its audio + its consent ledger are hard-deleted). `itemId` is
 * intentionally NOT an FK — the row it named no longer exists. `reason` distinguishes owner erasure
 * (right-to-erasure) from steward moderation.
 */
export const erasureAudit = pgTable("erasure_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemType: text("item_type").notNull(), // 'story' | 'ask' | 'voice_caption'
  itemId: uuid("item_id").notNull(),
  ownerPersonId: uuid("owner_person_id")
    .notNull()
    .references(() => persons.id),
  actorPersonId: uuid("actor_person_id")
    .notNull()
    .references(() => persons.id),
  reason: text("reason").notNull(), // 'owner_erasure' | 'steward_moderation'
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// ===========================================================================
// Kinship (ADR-0016) — the family-tree edges. A DISTINCT data category: NOT
// Story/Media content, so it does NOT widen the single front door and never
// grants content access. Kinship has its OWN authorized read surface
// (`@chronicle/core`'s kinship-repository) and its OWN architecture-test
// allowlist; the table objects live behind the guarded `@chronicle/db/kinship`
// subpath (parallel to `@chronicle/db/content`), never on the open schema.
// ===========================================================================

/** The two GENERATIVE primitives — the only kinship facts stored. Sibling / grandparent / cousin /
 *  in-law are DERIVED by walking these, never stored (so a derived fact can't contradict a stored
 *  one). `parent_of` is directed (personA = parent → personB = child); `partnered_with` is
 *  undirected (endpoints stored normalized low→high so (A,B) and (B,A) are one edge). No union node
 *  is ever stored (a GEDCOM `FAM` is shredded into these). */
export const kinshipEdgeTypeEnum = pgEnum("kinship_edge_type", [
  "parent_of",
  "partnered_with",
]);

/** The `nature` attribute of a `parent_of` edge (NULL for `partnered_with`). */
export const kinshipNatureEnum = pgEnum("kinship_nature", [
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
]);

/** The Steward-governed lifecycle of an edge (ADR-0016). Append-only: a transition SUPERSEDES with
 *  a new row, never edits. `asserted` = first-asserter-wins provisional truth (no confirmation
 *  needed); `affirmed`/`denied`/`corrected` = the Steward's exception governance. The latest row per
 *  logical edge is the current state; visible states are asserted|affirmed|corrected (denied hides
 *  it). The subject-HIDE veto is a SEPARATE dimension — see `kinship_subject_hides` — because it must
 *  override even a later Steward affirmation, which a single latest-wins lifecycle could not express. */
export const kinshipStateEnum = pgEnum("kinship_state", [
  "asserted",
  "affirmed",
  "denied",
  "corrected",
]);

// ---------------------------------------------------------------------------
// KinshipAssertion — the append-only edge ledger. One row per transition; the
// latest row per logical edge key (family_id, edge_type, person_a, person_b) is
// the current edge. Surfaced into a Family like a Story (ADR-0010): visible to
// that family's members, governed by that family's Steward. The same person-pair
// may be independently asserted in another family (its own rows) — never
// auto-propagated. Fully append-only (UPDATE/DELETE forbidden by trigger).
// ---------------------------------------------------------------------------
export const kinshipAssertions = pgTable(
  "kinship_assertions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic global sequence — the DETERMINISTIC supersede key (mirrors consentRecords.seq).
     *  The latest row per logical edge BY seq is the current state; `created_at` (transaction-start
     *  time) can tie, seq never does. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** The family this edge is surfaced into (ADR-0010). Governs visibility + which Steward rules. */
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    edgeType: kinshipEdgeTypeEnum("edge_type").notNull(),
    /** `parent_of`: the PARENT. `partnered_with`: the lower-id endpoint (normalized). */
    personAId: uuid("person_a_id")
      .notNull()
      .references(() => persons.id),
    /** `parent_of`: the CHILD. `partnered_with`: the higher-id endpoint (normalized). */
    personBId: uuid("person_b_id")
      .notNull()
      .references(() => persons.id),
    /** Set for `parent_of` (defaults to `unknown` at the write path), NULL for `partnered_with`.
     *  Part of the mutable payload, NOT the edge key: a nature correction is a NEW row on the same
     *  edge (Steward `corrected`), latest wins. */
    nature: kinshipNatureEnum("nature"),
    state: kinshipStateEnum("state").notNull().default("asserted"),
    /** Who created THIS transition row (audit). The edge's original asserter is the actor of its
     *  earliest row; `assertedBy` in the projection is resolved from that. */
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => persons.id),
    /** Optional free-text reason for a deny/correct (Steward exception governance). */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Latest-per-logical-edge resolution + "kin of a person within a family" both hit this.
    index("kinship_assertions_edge_idx").on(
      t.familyId,
      t.edgeType,
      t.personAId,
      t.personBId,
    ),
    index("kinship_assertions_person_a_idx").on(t.personAId),
    index("kinship_assertions_person_b_idx").on(t.personBId),
    // No self-edges.
    check("kinship_assertions_no_self_ck", sql`${t.personAId} <> ${t.personBId}`),
    // nature pairs with edge_type: present for parent_of, absent for partnered_with.
    check(
      "kinship_assertions_nature_ck",
      sql`(${t.edgeType} = 'parent_of' AND ${t.nature} IS NOT NULL) OR (${t.edgeType} = 'partnered_with' AND ${t.nature} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// KinshipSubjectHide — the subject's personal VETO (ADR-0016), a SEPARATE
// append-only dimension from the Steward lifecycle. The Person an edge is about
// may suppress it family-wide; this OVERRIDES even a Steward affirmation (being
// depicted at all is the subject's own consent, not a dispute the Steward
// adjudicates). Keyed to the same logical edge + the acting subject; the latest
// row per (edge, subject) wins (hidden = true suppresses, a later false un-hides).
// The hide-WRITE action + its "subject must be a real `self` account" rule land
// in issue #34; this table + the read-side overlay land here so the projection is
// correct from the start.
// ---------------------------------------------------------------------------
export const kinshipSubjectHides = pgTable(
  "kinship_subject_hides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic supersede key: latest row per (edge, subject) BY seq is the current veto state. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    edgeType: kinshipEdgeTypeEnum("edge_type").notNull(),
    personAId: uuid("person_a_id")
      .notNull()
      .references(() => persons.id),
    personBId: uuid("person_b_id")
      .notNull()
      .references(() => persons.id),
    /** The endpoint doing the hiding — must be personA or personB (the edge's subject). */
    subjectPersonId: uuid("subject_person_id")
      .notNull()
      .references(() => persons.id),
    /** true = suppress the edge family-wide; false = un-hide. Latest per (edge, subject) wins. */
    hidden: boolean("hidden").notNull(),
    /** Who acted (== subjectPersonId; recorded for audit symmetry with the assertion ledger). */
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("kinship_subject_hides_edge_subject_idx").on(
      t.familyId,
      t.edgeType,
      t.personAId,
      t.personBId,
      t.subjectPersonId,
    ),
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
export type AskFamily = typeof askFamilies.$inferSelect;
export type NewAskFamily = typeof askFamilies.$inferInsert;
export type LinkSession = typeof linkSessions.$inferSelect;
export type NewLinkSession = typeof linkSessions.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type JoinRequest = typeof joinRequests.$inferSelect;
export type NewJoinRequest = typeof joinRequests.$inferInsert;
export type MockAuthUser = typeof mockAuthUsers.$inferSelect;
export type NewMockAuthUser = typeof mockAuthUsers.$inferInsert;
export type GooglePhotosConnection = typeof googlePhotosConnections.$inferSelect;
export type NewGooglePhotosConnection = typeof googlePhotosConnections.$inferInsert;
export type StoryView = typeof storyViews.$inferSelect;
export type NewStoryView = typeof storyViews.$inferInsert;
export type StoryFamily = typeof storyFamilies.$inferSelect;
export type NewStoryFamily = typeof storyFamilies.$inferInsert;
export type ProseRevision = typeof proseRevisions.$inferSelect;
export type NewProseRevision = typeof proseRevisions.$inferInsert;
export type StoryRecording = typeof storyRecordings.$inferSelect;
export type NewStoryRecording = typeof storyRecordings.$inferInsert;
export type FollowUpDecisionRow = typeof followUpDecisions.$inferSelect;
export type NewFollowUpDecisionRow = typeof followUpDecisions.$inferInsert;

export type LifeStatus = (typeof lifeStatusEnum.enumValues)[number];
export type PersonOrigin = (typeof personOriginEnum.enumValues)[number];
export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
export type MembershipStatus = (typeof membershipStatusEnum.enumValues)[number];
export type StoryState = (typeof storyStateEnum.enumValues)[number];
export type StoryKind = (typeof storyKindEnum.enumValues)[number];
export type AudienceTier = (typeof audienceTierEnum.enumValues)[number];
export type MediaKind = (typeof mediaKindEnum.enumValues)[number];
export type ConsentAction = (typeof consentActionEnum.enumValues)[number];
export type AskStatus = (typeof askStatusEnum.enumValues)[number];
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];
export type JoinRequestStatus =
  (typeof joinRequestStatusEnum.enumValues)[number];
export type ProseRevisionLevel =
  (typeof proseRevisionLevelEnum.enumValues)[number];
export type IntakeAnswer = typeof intakeAnswers.$inferSelect;
export type NewIntakeAnswer = typeof intakeAnswers.$inferInsert;
export type IntakeRevision = typeof intakeRevisions.$inferSelect;
export type NewIntakeRevision = typeof intakeRevisions.$inferInsert;
export type IntakeOrigin = (typeof intakeOriginEnum.enumValues)[number];
export type FamilyPhoto = typeof familyPhotos.$inferSelect;
export type NewFamilyPhoto = typeof familyPhotos.$inferInsert;
export type FamilyPhotoFamily = typeof familyPhotoFamilies.$inferSelect;
export type NewFamilyPhotoFamily = typeof familyPhotoFamilies.$inferInsert;
export type PhotoSource = (typeof photoSourceEnum.enumValues)[number];
export type StoryImage = typeof storyImages.$inferSelect;
export type NewStoryImage = typeof storyImages.$inferInsert;
export type StoryImageProvenance =
  (typeof storyImageProvenanceEnum.enumValues)[number];
export type AskSubjectPhoto = typeof askSubjectPhotos.$inferSelect;
export type NewAskSubjectPhoto = typeof askSubjectPhotos.$inferInsert;
export type VoiceCaption = typeof voiceCaptions.$inferSelect;
export type NewVoiceCaption = typeof voiceCaptions.$inferInsert;
export type ErasureAudit = typeof erasureAudit.$inferSelect;
export type NewErasureAudit = typeof erasureAudit.$inferInsert;

export type StoryFavorite = typeof storyFavorites.$inferSelect;
export type NewStoryFavorite = typeof storyFavorites.$inferInsert;
export type StoryLike = typeof storyLikes.$inferSelect;
export type NewStoryLike = typeof storyLikes.$inferInsert;

export type KinshipAssertion = typeof kinshipAssertions.$inferSelect;
export type NewKinshipAssertion = typeof kinshipAssertions.$inferInsert;
export type KinshipSubjectHide = typeof kinshipSubjectHides.$inferSelect;
export type NewKinshipSubjectHide = typeof kinshipSubjectHides.$inferInsert;
export type KinshipEdgeType = (typeof kinshipEdgeTypeEnum.enumValues)[number];
export type KinshipNature = (typeof kinshipNatureEnum.enumValues)[number];
export type KinshipState = (typeof kinshipStateEnum.enumValues)[number];

