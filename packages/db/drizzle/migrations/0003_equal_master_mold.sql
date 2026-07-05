CREATE TABLE "ask_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_families" ADD CONSTRAINT "ask_families_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_families" ADD CONSTRAINT "ask_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ask_families_ask_family_uq" ON "ask_families" USING btree ("ask_id","family_id");--> statement-breakpoint
CREATE INDEX "ask_families_ask_idx" ON "ask_families" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_families_family_idx" ON "ask_families" USING btree ("family_id");--> statement-breakpoint
-- Hand-carried data preservation: backfill each ask's single legacy family context into the new
-- M2M join BEFORE dropping the column, so no existing routing target is lost.
INSERT INTO "ask_families" ("ask_id","family_id") SELECT "id","family_id" FROM "asks" WHERE "family_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" DROP CONSTRAINT "asks_family_id_families_id_fk";--> statement-breakpoint
ALTER TABLE "asks" DROP COLUMN "family_id";
