ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "invitee_phone" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "delivery_channels" text[];--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "delivery_error" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "delivery_attempts" integer DEFAULT 0 NOT NULL;
