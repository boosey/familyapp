ALTER TYPE "public"."media_kind" ADD VALUE 'caption_audio' BEFORE 'photo';--> statement-breakpoint
CREATE TABLE "erasure_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_captions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"transcript" text,
	"owner_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "recording_media_id" uuid;--> statement-breakpoint
ALTER TABLE "erasure_audit" ADD CONSTRAINT "erasure_audit_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_audit" ADD CONSTRAINT "erasure_audit_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_captions_photo_idx" ON "voice_captions" USING btree ("photo_id");--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_recording_media_id_media_id_fk" FOREIGN KEY ("recording_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;