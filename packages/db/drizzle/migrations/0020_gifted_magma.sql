CREATE TABLE "account_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_contacts_kind_value_uq" ON "account_contacts" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "account_contacts_account_id_idx" ON "account_contacts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_identities_provider_user_uq" ON "account_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "account_identities_account_id_idx" ON "account_identities" USING btree ("account_id");--> statement-breakpoint
-- Backfill: every existing account becomes matchable by its (clerk) id and verified email.
INSERT INTO account_identities (account_id, provider, provider_user_id)
SELECT id, 'clerk', auth_provider_user_id FROM accounts
ON CONFLICT (provider, provider_user_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO account_contacts (account_id, kind, value, verified_at)
SELECT id, 'email', lower(trim(email)), now()
FROM accounts
WHERE email IS NOT NULL AND length(trim(email)) > 0
ON CONFLICT (kind, value) DO NOTHING;