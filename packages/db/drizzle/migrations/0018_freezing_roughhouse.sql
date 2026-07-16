ALTER TABLE "stories" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "processing_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "processing_attempt" integer DEFAULT 0 NOT NULL;