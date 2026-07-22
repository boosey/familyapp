CREATE TYPE "public"."notification_frequency" AS ENUM('every_item', 'daily_digest', 'weekly_digest', 'off');--> statement-breakpoint
CREATE TYPE "public"."notification_stream" AS ENUM('questions_for_me', 'answers_to_my_asks', 'family_activity');--> statement-breakpoint
CREATE TABLE "notification_stream_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"stream" "notification_stream" NOT NULL,
	"frequency" "notification_frequency" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_stream_prefs" ADD CONSTRAINT "notification_stream_prefs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_stream_prefs_person_idx" ON "notification_stream_prefs" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_stream_prefs_person_stream_uq" ON "notification_stream_prefs" USING btree ("person_id","stream");