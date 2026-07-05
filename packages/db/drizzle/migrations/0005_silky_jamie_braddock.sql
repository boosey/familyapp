CREATE TABLE "story_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_favorites" ADD CONSTRAINT "story_favorites_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_favorites" ADD CONSTRAINT "story_favorites_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_likes" ADD CONSTRAINT "story_likes_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_likes" ADD CONSTRAINT "story_likes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_favorites_story_person_uq" ON "story_favorites" USING btree ("story_id","person_id");--> statement-breakpoint
CREATE INDEX "story_favorites_person_idx" ON "story_favorites" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_likes_story_person_uq" ON "story_likes" USING btree ("story_id","person_id");--> statement-breakpoint
CREATE INDEX "story_likes_person_idx" ON "story_likes" USING btree ("person_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chronicle_media_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
       SELECT 1 FROM stories
       WHERE recording_media_id = OLD.id
         AND id::text <> COALESCE(current_setting('chronicle.cascade_delete_story', true), '')
     )
     OR EXISTS (
       SELECT 1 FROM story_recordings
       WHERE media_id = OLD.id
         AND story_id::text <> COALESCE(current_setting('chronicle.cascade_delete_story', true), '')
     )
     OR EXISTS (SELECT 1 FROM asks WHERE recording_media_id = OLD.id)
     OR EXISTS (SELECT 1 FROM voice_captions WHERE media_id = OLD.id)
     OR EXISTS (
       SELECT 1 FROM consent_records
       WHERE approval_audio_media_id = OLD.id
         AND story_id::text <> COALESCE(current_setting('chronicle.cascade_delete_story', true), '')
     )
  THEN
    RAISE EXCEPTION
      'Cannot delete media %: a live item references it. Content audio is an immutable artifact while its item exists (ADR-0008); it is removed only when the item itself is deleted.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;