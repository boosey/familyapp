CREATE TYPE "public"."kinship_edge_type" AS ENUM('parent_of', 'partnered_with');--> statement-breakpoint
CREATE TYPE "public"."kinship_nature" AS ENUM('biological', 'adoptive', 'step', 'foster', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."kinship_state" AS ENUM('asserted', 'affirmed', 'denied', 'corrected');--> statement-breakpoint
CREATE TABLE "kinship_assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"family_id" uuid NOT NULL,
	"edge_type" "kinship_edge_type" NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"nature" "kinship_nature",
	"state" "kinship_state" DEFAULT 'asserted' NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kinship_assertions_no_self_ck" CHECK ("kinship_assertions"."person_a_id" <> "kinship_assertions"."person_b_id"),
	CONSTRAINT "kinship_assertions_nature_ck" CHECK (("kinship_assertions"."edge_type" = 'parent_of' AND "kinship_assertions"."nature" IS NOT NULL) OR ("kinship_assertions"."edge_type" = 'partnered_with' AND "kinship_assertions"."nature" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "kinship_subject_hides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"family_id" uuid NOT NULL,
	"edge_type" "kinship_edge_type" NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"hidden" boolean NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kinship_assertions" ADD CONSTRAINT "kinship_assertions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_assertions" ADD CONSTRAINT "kinship_assertions_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_assertions" ADD CONSTRAINT "kinship_assertions_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_assertions" ADD CONSTRAINT "kinship_assertions_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_subject_hides" ADD CONSTRAINT "kinship_subject_hides_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_subject_hides" ADD CONSTRAINT "kinship_subject_hides_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_subject_hides" ADD CONSTRAINT "kinship_subject_hides_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_subject_hides" ADD CONSTRAINT "kinship_subject_hides_subject_person_id_persons_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kinship_subject_hides" ADD CONSTRAINT "kinship_subject_hides_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kinship_assertions_edge_idx" ON "kinship_assertions" USING btree ("family_id","edge_type","person_a_id","person_b_id");--> statement-breakpoint
CREATE INDEX "kinship_assertions_person_a_idx" ON "kinship_assertions" USING btree ("person_a_id");--> statement-breakpoint
CREATE INDEX "kinship_assertions_person_b_idx" ON "kinship_assertions" USING btree ("person_b_id");--> statement-breakpoint
CREATE INDEX "kinship_subject_hides_edge_subject_idx" ON "kinship_subject_hides" USING btree ("family_id","edge_type","person_a_id","person_b_id","subject_person_id");--> statement-breakpoint
-- Hand-carried from invariants.sql (drizzle-kit does not model triggers): the kinship ledgers are
-- append-only (ADR-0016). Every transition SUPERSEDES with a new row; UPDATE and DELETE are both
-- forbidden. Reuses the shared chronicle_forbid_mutation() guard (defined in an earlier migration).
CREATE TRIGGER kinship_assertions_append_only
  BEFORE UPDATE OR DELETE ON kinship_assertions
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER kinship_subject_hides_append_only
  BEFORE UPDATE OR DELETE ON kinship_subject_hides
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();