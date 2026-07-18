CREATE TABLE "invitation_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_dismissals" ADD CONSTRAINT "invitation_dismissals_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_dismissals" ADD CONSTRAINT "invitation_dismissals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_dismissals_invitation_account_uq" ON "invitation_dismissals" USING btree ("invitation_id","account_id");--> statement-breakpoint
CREATE INDEX "invitation_dismissals_account_idx" ON "invitation_dismissals" USING btree ("account_id");