ALTER TABLE "asks" DROP CONSTRAINT "asks_source_story_id_stories_id_fk";
--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_source_story_id_stories_id_fk" FOREIGN KEY ("source_story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;