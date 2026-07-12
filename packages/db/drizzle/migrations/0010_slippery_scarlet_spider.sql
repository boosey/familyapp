CREATE TABLE "story_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"tagged_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_subjects" ADD CONSTRAINT "story_subjects_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_subjects" ADD CONSTRAINT "story_subjects_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_subjects" ADD CONSTRAINT "story_subjects_tagged_by_person_id_persons_id_fk" FOREIGN KEY ("tagged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_subjects_story_person_uq" ON "story_subjects" USING btree ("story_id","person_id");--> statement-breakpoint
CREATE INDEX "story_subjects_story_idx" ON "story_subjects" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_subjects_person_idx" ON "story_subjects" USING btree ("person_id");