ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "source_story_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asks" ADD CONSTRAINT "asks_source_story_id_stories_id_fk" FOREIGN KEY ("source_story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asks_source_story_idx" ON "asks" USING btree ("source_story_id");
