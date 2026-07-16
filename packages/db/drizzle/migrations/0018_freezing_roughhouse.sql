-- IF NOT EXISTS: this migration was originally authored as 0016_narrow_lorna_dane and applied to the
-- durable (production) Neon branch by an earlier preview deploy of PR #11 BEFORE it was renumbered to
-- 0018 to resolve a migration-number collision with master's 0016/0017. Those columns therefore already
-- exist on that branch; the guard makes re-application a safe no-op there while still creating them on
-- any fresh database (the drift guard replays the chain from empty). See PR #88 conflict resolution.
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "processing_error" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "processing_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "processing_attempt" integer DEFAULT 0 NOT NULL;