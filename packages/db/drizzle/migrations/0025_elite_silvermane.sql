ALTER TABLE "invitation_dismissals" DROP CONSTRAINT "invitation_dismissals_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation_dismissals" ADD CONSTRAINT "invitation_dismissals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;