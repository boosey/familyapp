CREATE TYPE "public"."ask_status" AS ENUM('queued', 'routed', 'answered');--> statement-breakpoint
CREATE TYPE "public"."audience_tier" AS ENUM('private', 'branch', 'family', 'public');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('approved_for_sharing', 'set_audience_tier', 'revoked', 'paused_membership');--> statement-breakpoint
CREATE TYPE "public"."follow_up_outcome" AS ENUM('answered', 'skipped', 'off_ramped');--> statement-breakpoint
CREATE TYPE "public"."follow_up_record_kind" AS ENUM('decision', 'outcome');--> statement-breakpoint
CREATE TYPE "public"."intake_origin" AS ENUM('voice', 'typed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."life_status" AS ENUM('living', 'deceased');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('story_audio', 'approval_audio', 'intake_audio', 'photo', 'document');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('narrator', 'member', 'steward');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."photo_source" AS ENUM('upload', 'google_picker');--> statement-breakpoint
CREATE TYPE "public"."prose_revision_level" AS ENUM('user_authored', 'ai_transcribed', 'ai_cleaned', 'ai_polished', 'human_corrected', 'ai_verified');--> statement-breakpoint
CREATE TYPE "public"."story_image_provenance" AS ENUM('family_photo', 'illustration');--> statement-breakpoint
CREATE TYPE "public"."story_kind" AS ENUM('voice', 'text');--> statement-breakpoint
CREATE TYPE "public"."story_state" AS ENUM('draft', 'pending_approval', 'approved', 'shared', 'archived');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider_user_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_subject_photos" (
	"seq" bigserial NOT NULL,
	"ask_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_subject_photos_ask_id_photo_id_pk" PRIMARY KEY("ask_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asker_person_id" uuid NOT NULL,
	"target_person_id" uuid NOT NULL,
	"family_id" uuid,
	"question_text" text NOT NULL,
	"status" "ask_status" DEFAULT 'queued' NOT NULL,
	"story_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routed_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"person_id" uuid NOT NULL,
	"story_id" uuid,
	"scope" text,
	"action" "consent_action" NOT NULL,
	"resulting_state" text NOT NULL,
	"approval_audio_media_id" uuid,
	"actor_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discoverable" boolean DEFAULT false NOT NULL,
	"creator_person_id" uuid NOT NULL,
	"steward_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_photo_families" (
	"photo_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_photo_families_photo_id_family_id_pk" PRIMARY KEY("photo_id","family_id")
);
--> statement-breakpoint
CREATE TABLE "family_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contributor_person_id" uuid NOT NULL,
	"source" "photo_source" NOT NULL,
	"storage_key" text NOT NULL,
	"caption" text,
	"exif_captured_at" timestamp with time zone,
	"exif_gps" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "family_photos_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "follow_up_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"story_id" uuid NOT NULL,
	"thread_position" integer NOT NULL,
	"record_kind" "follow_up_record_kind" NOT NULL,
	"evaluator_model_id" text,
	"candidates" jsonb,
	"dispositions" jsonb,
	"selected_seed" text,
	"phrased_line" text,
	"policy" jsonb,
	"decision_id" uuid,
	"outcome" "follow_up_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"prompt_question" text NOT NULL,
	"origin" "intake_origin" NOT NULL,
	"media_id" uuid,
	"transcript" text,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"inviter_person_id" uuid NOT NULL,
	"invitee_person_id" uuid NOT NULL,
	"invitee_name" text,
	"invitee_email" text,
	"relationship_label" text,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"accepted_person_id" uuid,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"requester_person_id" uuid NOT NULL,
	"message" text,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by_person_id" uuid,
	"resulting_membership_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"person_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"invited_by_person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"duration_seconds" integer,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_auth_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"auth_provider_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"spoken_name" text NOT NULL,
	"birth_year" integer,
	"birth_date" date,
	"onboarded_at" timestamp with time zone,
	"biographical_anchors" jsonb DEFAULT '{}'::jsonb,
	"life_status" "life_status" DEFAULT 'living' NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prose_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"story_id" uuid NOT NULL,
	"level" "prose_revision_level" NOT NULL,
	"text" text NOT NULL,
	"model_id" text,
	"prompt_text" text,
	"actor_person_id" uuid,
	"story_recording_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"state" "story_state" DEFAULT 'draft' NOT NULL,
	"kind" "story_kind" DEFAULT 'voice' NOT NULL,
	"audience_tier" "audience_tier" DEFAULT 'private' NOT NULL,
	"recording_media_id" uuid,
	"transcript" text,
	"transcript_word_timings" jsonb,
	"prose" text,
	"title" text,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"era_year" integer,
	"era_label" text,
	"prompt_question" text,
	"ask_id" uuid,
	"originating_family_id" uuid,
	"subject_photo_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_photo_id" uuid,
	"provenance" "story_image_provenance" DEFAULT 'family_photo' NOT NULL,
	"source_url" text,
	"license" text,
	"attribution" text,
	"thumbnail_url" text,
	"is_cover" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"attached_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_id" uuid NOT NULL,
	"transcript" text,
	"transcript_word_timings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_subject_photos" ADD CONSTRAINT "ask_subject_photos_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_subject_photos" ADD CONSTRAINT "ask_subject_photos_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_asker_person_id_persons_id_fk" FOREIGN KEY ("asker_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_target_person_id_persons_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_approval_audio_media_id_media_id_fk" FOREIGN KEY ("approval_audio_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_creator_person_id_persons_id_fk" FOREIGN KEY ("creator_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_steward_person_id_persons_id_fk" FOREIGN KEY ("steward_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_photo_families" ADD CONSTRAINT "family_photo_families_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_photo_families" ADD CONSTRAINT "family_photo_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_photos" ADD CONSTRAINT "family_photos_contributor_person_id_persons_id_fk" FOREIGN KEY ("contributor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_decisions" ADD CONSTRAINT "follow_up_decisions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_decisions" ADD CONSTRAINT "follow_up_decisions_decision_id_follow_up_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."follow_up_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_answers" ADD CONSTRAINT "intake_answers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_answers" ADD CONSTRAINT "intake_answers_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_person_id_persons_id_fk" FOREIGN KEY ("inviter_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitee_person_id_persons_id_fk" FOREIGN KEY ("invitee_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_person_id_persons_id_fk" FOREIGN KEY ("accepted_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_requester_person_id_persons_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_resulting_membership_id_memberships_id_fk" FOREIGN KEY ("resulting_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_sessions" ADD CONSTRAINT "link_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_sessions" ADD CONSTRAINT "link_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_sessions" ADD CONSTRAINT "link_sessions_invited_by_person_id_persons_id_fk" FOREIGN KEY ("invited_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prose_revisions" ADD CONSTRAINT "prose_revisions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prose_revisions" ADD CONSTRAINT "prose_revisions_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prose_revisions" ADD CONSTRAINT "prose_revisions_story_recording_id_story_recordings_id_fk" FOREIGN KEY ("story_recording_id") REFERENCES "public"."story_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_recording_media_id_media_id_fk" FOREIGN KEY ("recording_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_originating_family_id_families_id_fk" FOREIGN KEY ("originating_family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_subject_photo_id_family_photos_id_fk" FOREIGN KEY ("subject_photo_id") REFERENCES "public"."family_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_families" ADD CONSTRAINT "story_families_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_families" ADD CONSTRAINT "story_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_images" ADD CONSTRAINT "story_images_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_images" ADD CONSTRAINT "story_images_family_photo_id_family_photos_id_fk" FOREIGN KEY ("family_photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_images" ADD CONSTRAINT "story_images_attached_by_person_id_persons_id_fk" FOREIGN KEY ("attached_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_recordings" ADD CONSTRAINT "story_recordings_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_recordings" ADD CONSTRAINT "story_recordings_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_auth_provider_user_id_uq" ON "accounts" USING btree ("auth_provider_user_id");--> statement-breakpoint
CREATE INDEX "ask_subject_photos_photo_idx" ON "ask_subject_photos" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "asks_target_idx" ON "asks" USING btree ("target_person_id");--> statement-breakpoint
CREATE INDEX "asks_status_idx" ON "asks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consent_person_idx" ON "consent_records" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "consent_story_idx" ON "consent_records" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "family_photo_families_family_idx" ON "family_photo_families" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "family_photos_contributor_idx" ON "family_photos" USING btree ("contributor_person_id");--> statement-breakpoint
CREATE INDEX "follow_up_decisions_story_idx" ON "follow_up_decisions" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "intake_answers_person_idx" ON "intake_answers" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_answers_person_question_uq" ON "intake_answers" USING btree ("person_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_family_idx" ON "invitations" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "join_requests_family_idx" ON "join_requests" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "join_requests_requester_idx" ON "join_requests" USING btree ("requester_person_id");--> statement-breakpoint
CREATE INDEX "join_requests_status_idx" ON "join_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "link_sessions_token_hash_uq" ON "link_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "link_sessions_person_idx" ON "link_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "memberships_person_idx" ON "memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memberships_family_idx" ON "memberships" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_auth_users_email_uq" ON "mock_auth_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_auth_users_provider_id_uq" ON "mock_auth_users" USING btree ("auth_provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_account_id_uq" ON "persons" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "prose_revisions_story_idx" ON "prose_revisions" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "stories_owner_idx" ON "stories" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "stories_state_idx" ON "stories" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "story_families_story_family_uq" ON "story_families" USING btree ("story_id","family_id");--> statement-breakpoint
CREATE INDEX "story_families_story_idx" ON "story_families" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_families_family_idx" ON "story_families" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "story_images_story_idx" ON "story_images" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_images_story_position_uq" ON "story_images" USING btree ("story_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "story_images_story_photo_uq" ON "story_images" USING btree ("story_id","family_photo_id");--> statement-breakpoint
CREATE INDEX "story_recordings_story_idx" ON "story_recordings" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_recordings_story_position_uq" ON "story_recordings" USING btree ("story_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "story_views_story_person_uq" ON "story_views" USING btree ("story_id","person_id");--> statement-breakpoint
CREATE INDEX "story_views_person_idx" ON "story_views" USING btree ("person_id");
-- >>> invariants (hand-carried; drizzle-kit does not model triggers / partial unique indexes) <<<
-- Contents below are copied verbatim from packages/db/drizzle/invariants.sql at baseline time.
-- Future invariant CHANGES go in their own numbered migration, hand-written.
-- Structural invariants that drizzle-kit does not model. Applied right after schema.sql (the
-- generated table DDL) on every fresh/reset database. These are the load-bearing guarantees of
-- Phase 0, enforced in the database itself so no application bug — and no future query path — can
-- bypass them. Hand-maintained (schema.ts can't express triggers or partial-WHERE indexes).

-- ---------------------------------------------------------------------------
-- (1) Append-only / immutable rows. A single guard function raises on any UPDATE or DELETE.
--     Used for the consent ledger (revocation = a NEW superseding row, never an edit) and for
--     Media (the canonical recording is never overwritten or lost; new versions are new rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION chronicle_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- The consent ledger: no UPDATE, no DELETE. Ever.
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();

-- Prose revisions: the prose provenance ledger (L1 user_authored/transcribed → L2 polished →
-- L3 corrected). Consent-scoped immutability, exactly like Media and the ordered take set
-- (ADR-0002/0007):
--   UPDATE → always forbidden (a correction is a NEW row, never an edit — the ledger is append-only).
--   DELETE → allowed ONLY when the owning Story has no consent_records row. Once a story is
--            approved/shared its prose lineage is frozen forever (it is the L2→L3 audit/diff
--            signal); but a never-consented draft that is being DISCARDED wholesale (ADR-0002) must
--            take its prose revisions with it. A text draft (ADR-0007) always carries a
--            `user_authored` L1, so without this carve-out a text draft could never be discarded.
CREATE OR REPLACE FUNCTION chronicle_prose_revision_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM consent_records WHERE story_id = OLD.story_id) THEN
    RAISE EXCEPTION
      'Cannot delete prose_revision %: its story has consent records; prose lineage is immutable after sharing.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prose_revisions_append_only
  BEFORE UPDATE OR DELETE ON prose_revisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_prose_revision_delete_guard();

-- Follow-up decision ledger: append-only (ADR-0013). Reuses the shared guard. A follow-up
-- OUTCOME is a NEW row referencing its decision, never an edit of the decision row.
CREATE TRIGGER follow_up_decisions_append_only
  BEFORE UPDATE OR DELETE ON follow_up_decisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();

-- Media: consent-scoped immutability per ADR-0002.
--   UPDATE  → always forbidden (we never mutate audio bytes or their metadata).
--   DELETE  → allowed ONLY when neither the media row nor its owning Story is linked to any
--             consent_records row.  The recording clip AND the approval-audio clip of any
--             approved/shared story stay immutable forever; never-consented draft takes may
--             be reclaimed.
-- A single function handles both ops via TG_OP so one trigger covers both.
CREATE OR REPLACE FUNCTION chronicle_media_delete_guard()
RETURNS trigger AS $$
BEGIN
  -- UPDATE is unconditionally forbidden.
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: check (a) — is this media row referenced directly by any consent record?
  IF EXISTS (
    SELECT 1 FROM consent_records WHERE approval_audio_media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: it is referenced by a consent record (approval_audio_media_id). Consented media is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: check (b) — does this media's owning Story (recording_media_id = OLD.id) have
  -- any consent_records row?  If so, the recording is part of the audit trail and must stay.
  IF EXISTS (
    SELECT 1 FROM stories s
    INNER JOIN consent_records cr ON cr.story_id = s.id
    WHERE s.recording_media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: its owning story has consent records. Story recording media is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: check (c) — ADR-0014 fork #2. Defense-in-depth + a consent-semantic error message for
  -- take-backing media. The FK (story_recordings.media_id NO ACTION) plus the
  -- story_recordings_post_consent_immutable trigger already prevent losing this audio; this check
  -- restates that invariant at the media layer and yields a consent-worded error instead of a raw
  -- FK violation. Covers position >= 1 takes AND typed-first mixed-take audio that check (b)'s
  -- recording_media_id pointer never sees.
  IF EXISTS (
    SELECT 1 FROM story_recordings sr
    INNER JOIN consent_records cr ON cr.story_id = sr.story_id
    WHERE sr.media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: it backs a take of a story with consent records. Consented take audio is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_immutable
  BEFORE UPDATE OR DELETE ON media
  FOR EACH ROW EXECUTE FUNCTION chronicle_media_delete_guard();

-- The canonical recording pointer is itself immutable. The consent-scoped media guard above
-- protects a media row from deletion while its owning Story has consent records — but that link
-- is `stories.recording_media_id`. If that pointer could be re-aimed at a different media row,
-- a consented story's original recording would become an orphan and the guard would then permit
-- its deletion. So we forbid CHANGING `recording_media_id` once set, in the database, independent
-- of any application write path. (Every other column on `stories` — state, tier, derived prose,
-- etc. — stays freely mutable; this trigger fires ONLY when the recording pointer actually
-- changes.) This matches the data model: "Media is created first, then the Story points at it",
-- and the pointer never moves.
CREATE OR REPLACE FUNCTION chronicle_story_recording_pointer_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.recording_media_id IS DISTINCT FROM OLD.recording_media_id THEN
    RAISE EXCEPTION
      'stories.recording_media_id is immutable (the canonical recording pointer never moves): % -> %',
      OLD.recording_media_id, NEW.recording_media_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stories_recording_pointer_immutable
  BEFORE UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_recording_pointer_immutable();

-- Story takes are immutable AFTER approval (ADR-0012): a take may be dropped/re-recorded only
-- while the story has no consent records (pre-approval). Once the story is approved (a consent
-- row exists), the ordered take set is frozen — removable only by deleting the whole Story.
-- (UPDATE is left permitted so the transcribe step can backfill the derived transcript column;
-- the canonical AUDIO is protected by the media_immutable guard, not this one.)
CREATE OR REPLACE FUNCTION chronicle_story_recording_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM consent_records WHERE story_id = OLD.story_id) THEN
    RAISE EXCEPTION
      'Cannot delete story_recording %: its story has consent records; takes are immutable after approval.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_recordings_post_consent_immutable
  BEFORE DELETE ON story_recordings
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_recording_delete_guard();

-- ---------------------------------------------------------------------------
-- (1f) ADR-0014 §3: the kind ⇔ recording invariant for MIXED drafts (supersedes the ADR-0007
--      take-0-only CHECK). A draft is a live composition of interleaved voice + typed takes;
--      "any audio ⇒ voice". Enforced in two parts:
--        (a) a single-table CHECK for the text-half (needs no cross-table lookup);
--        (b) a DEFERRABLE INITIALLY DEFERRED constraint trigger for the voice biconditional,
--            checked at COMMIT so the audited repo may, within one tx, insert the first take and
--            flip kind in either order.
-- ---------------------------------------------------------------------------

-- (a) text ⇒ no canonical recording pointer. (voice MAY have a NULL pointer — a typed-first draft
--     that later gets a voice take keeps recording_media_id = NULL; its audio is the take set.)
ALTER TABLE stories ADD CONSTRAINT stories_text_no_recording_ck CHECK (
  NOT (kind = 'text' AND recording_media_id IS NOT NULL)
);

-- (b) The biconditional (kind = 'voice') ⟺ (EXISTS a story_recordings row for the story).
--     Deferred to COMMIT. The function is shared by triggers on BOTH stories and story_recordings
--     and re-derives the affected story id from whichever table fired. If the story no longer
--     exists (whole-draft discard deletes its takes AND the story in one tx), there is nothing to
--     enforce — return cleanly.
CREATE OR REPLACE FUNCTION chronicle_story_kind_recording_biconditional()
RETURNS trigger AS $$
DECLARE
  v_story_id uuid;
  v_kind story_kind;
  v_has_recording boolean;
BEGIN
  IF TG_TABLE_NAME = 'stories' THEN
    v_story_id := NEW.id;              -- fired on stories INSERT/UPDATE
  ELSE
    v_story_id := COALESCE(NEW.story_id, OLD.story_id);  -- story_recordings INSERT/DELETE
  END IF;

  SELECT kind INTO v_kind FROM stories WHERE id = v_story_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- story deleted in this tx (discard); nothing to enforce.
  END IF;

  v_has_recording := EXISTS (SELECT 1 FROM story_recordings WHERE story_id = v_story_id);

  IF (v_kind = 'voice') <> v_has_recording THEN
    RAISE EXCEPTION
      'story % violates the ADR-0014 kind/recording invariant: kind=%, has_recording=% (voice ⟺ ≥1 story_recordings row)',
      v_story_id, v_kind, v_has_recording
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger: return value ignored.
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER stories_kind_recording_biconditional
  AFTER INSERT OR UPDATE ON stories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();

-- Fires only on INSERT/DELETE (not UPDATE): a take's story_id is assumed IMMUTABLE — takes are
-- inserted and deleted, never re-parented to another story (moving a take between stories is not a
-- modeled operation), so the pair of affected stories can only change on those two ops. Covering
-- UPDATE would also be costly: a constraint trigger cannot take a WHEN clause, so an UPDATE variant
-- could not be scoped to story_id changes and would re-run the biconditional at COMMIT on every
-- transcript backfill — the hot path.
CREATE CONSTRAINT TRIGGER story_recordings_kind_recording_biconditional
  AFTER INSERT OR DELETE ON story_recordings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();

-- ---------------------------------------------------------------------------
-- (2) At most one ACTIVE membership per (person, family). Ended/paused rows may coexist, so a
--     person can leave and rejoin a family over time without violating this. A partial unique
--     index is the right tool; drizzle-kit cannot express the WHERE clause.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX memberships_one_active_per_family_uq
  ON memberships (person_id, family_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- (3) At most one PENDING join request per (family, requester). Approved/declined rows may
--     coexist, so a requester whose earlier request was declined can ask again later. The partial
--     unique index also closes the phantom-read race a transaction alone cannot under READ
--     COMMITTED: two concurrent createJoinRequest calls both SELECT "no pending" and both INSERT —
--     the index makes the second INSERT fail (mapped in the repository to the existing "a pending
--     request already exists" InvariantViolation). See ADR-0001.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX join_requests_one_pending_uq
  ON join_requests (family_id, requester_person_id)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- (4) At most one COVER image per story (ADR-0009 accompaniment). A story has exactly one cover;
--     the write path (story-image-repository.ts) keeps this true by clearing every other image's
--     `is_cover` before setting the target (and by making the FIRST attached image the cover). This
--     partial unique index is the structural backstop the application logic can't express in
--     drizzle-kit — two rows with is_cover = true for the same story_id is impossible in the DB.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX story_images_one_cover_uq
  ON story_images (story_id)
  WHERE is_cover;
