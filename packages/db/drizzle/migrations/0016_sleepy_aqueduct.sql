ALTER TABLE "asks" ADD COLUMN "source_story_id" uuid;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_source_story_id_stories_id_fk" FOREIGN KEY ("source_story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asks_source_story_idx" ON "asks" USING btree ("source_story_id");