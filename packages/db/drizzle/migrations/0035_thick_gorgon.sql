CREATE TYPE "public"."narrator_memory_origin" AS ENUM('extracted', 'user');--> statement-breakpoint
CREATE TYPE "public"."narrator_memory_status" AS ENUM('active', 'superseded', 'dismissed');--> statement-breakpoint
CREATE TABLE "narrator_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"origin" "narrator_memory_origin" NOT NULL,
	"source_story_id" uuid,
	"confidence" real,
	"status" "narrator_memory_status" DEFAULT 'active' NOT NULL,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "narrator_memory" ADD CONSTRAINT "narrator_memory_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrator_memory" ADD CONSTRAINT "narrator_memory_source_story_id_stories_id_fk" FOREIGN KEY ("source_story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrator_memory" ADD CONSTRAINT "narrator_memory_superseded_by_narrator_memory_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."narrator_memory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "narrator_memory_person_idx" ON "narrator_memory" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "narrator_memory_person_status_idx" ON "narrator_memory" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "narrator_memory_source_story_idx" ON "narrator_memory" USING btree ("source_story_id");--> statement-breakpoint
-- #362 (hand-carried; drizzle-kit does not model triggers): narrator-memory is append-only in its
-- CONTENT but its lifecycle (status/superseded_by) is mutable. A BEFORE UPDATE guard RAISEs on any
-- content-column change and permits only status/superseded_by to move. DELETE is unguarded so the
-- audited erasure paths can remove rows (the FKs to persons/stories have no cascade). Mirrors
-- invariants.sql exactly — keep the two in sync.
CREATE OR REPLACE FUNCTION chronicle_narrator_memory_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.tags IS DISTINCT FROM OLD.tags
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.source_story_id IS DISTINCT FROM OLD.source_story_id
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Table % content is immutable: only status/superseded_by may change (a correction is a new row).',
      TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER narrator_memory_content_immutable
  BEFORE UPDATE ON narrator_memory
  FOR EACH ROW EXECUTE FUNCTION chronicle_narrator_memory_guard();