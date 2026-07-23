ALTER TABLE "accounts" ADD COLUMN "sms_phone" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sms_opted_in_at" timestamp with time zone;