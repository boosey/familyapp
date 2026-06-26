CREATE TYPE "public"."ask_status" AS ENUM('queued', 'routed', 'answered');--> statement-breakpoint
CREATE TYPE "public"."audience_tier" AS ENUM('private', 'branch', 'family', 'public');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('approved_for_sharing', 'set_audience_tier', 'revoked', 'paused_membership');--> statement-breakpoint
CREATE TYPE "public"."life_status" AS ENUM('living', 'deceased');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('story_audio', 'approval_audio', 'photo', 'document');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('narrator', 'member', 'steward');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
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
CREATE TABLE "elder_sessions" (
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
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"creator_person_id" uuid NOT NULL,
	"steward_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"spoken_name" text NOT NULL,
	"birth_year" integer,
	"biographical_anchors" jsonb DEFAULT '{}'::jsonb,
	"life_status" "life_status" DEFAULT 'living' NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"state" "story_state" DEFAULT 'draft' NOT NULL,
	"audience_tier" "audience_tier" DEFAULT 'private' NOT NULL,
	"recording_media_id" uuid NOT NULL,
	"transcript" text,
	"transcript_word_timings" jsonb,
	"prose" text,
	"title" text,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"prompt_question" text,
	"ask_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_asker_person_id_persons_id_fk" FOREIGN KEY ("asker_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_target_person_id_persons_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_approval_audio_media_id_media_id_fk" FOREIGN KEY ("approval_audio_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elder_sessions" ADD CONSTRAINT "elder_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elder_sessions" ADD CONSTRAINT "elder_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elder_sessions" ADD CONSTRAINT "elder_sessions_invited_by_person_id_persons_id_fk" FOREIGN KEY ("invited_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_creator_person_id_persons_id_fk" FOREIGN KEY ("creator_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_steward_person_id_persons_id_fk" FOREIGN KEY ("steward_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_recording_media_id_media_id_fk" FOREIGN KEY ("recording_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_auth_provider_user_id_uq" ON "accounts" USING btree ("auth_provider_user_id");--> statement-breakpoint
CREATE INDEX "asks_target_idx" ON "asks" USING btree ("target_person_id");--> statement-breakpoint
CREATE INDEX "asks_status_idx" ON "asks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consent_person_idx" ON "consent_records" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "consent_story_idx" ON "consent_records" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "elder_sessions_token_hash_uq" ON "elder_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "elder_sessions_person_idx" ON "elder_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "memberships_person_idx" ON "memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memberships_family_idx" ON "memberships" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_account_id_uq" ON "persons" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "stories_owner_idx" ON "stories" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "stories_state_idx" ON "stories" USING btree ("state");