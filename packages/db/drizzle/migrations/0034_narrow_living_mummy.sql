ALTER TABLE "persons" ADD COLUMN "hide_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "hide_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "follow_ups_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "ask_suggestion_opt_out" boolean DEFAULT false NOT NULL;