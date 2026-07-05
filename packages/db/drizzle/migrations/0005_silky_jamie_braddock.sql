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