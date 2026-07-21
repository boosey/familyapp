CREATE TYPE "public"."life_event_kind" AS ENUM('wedding', 'graduation', 'military_service', 'move', 'other');--> statement-breakpoint
CREATE TYPE "public"."occurred_kind" AS ENUM('date', 'circa', 'period');--> statement-breakpoint
CREATE TABLE "life_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "life_event_kind" NOT NULL,
	"occurred_kind" "occurred_kind" NOT NULL,
	"occurred_date" date NOT NULL,
	"occurred_end_date" date,
	"occurred_provenance" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "occurred_kind" "occurred_kind";--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "occurred_date" date;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "occurred_end_date" date;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "occurred_provenance" text;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "life_events_person_idx" ON "life_events" USING btree ("person_id");