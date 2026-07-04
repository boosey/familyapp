CREATE TABLE "intake_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"intake_answer_id" uuid NOT NULL,
	"level" "prose_revision_level" NOT NULL,
	"text" text NOT NULL,
	"model_id" text,
	"prompt_text" text,
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_revisions" ADD CONSTRAINT "intake_revisions_intake_answer_id_intake_answers_id_fk" FOREIGN KEY ("intake_answer_id") REFERENCES "public"."intake_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_revisions" ADD CONSTRAINT "intake_revisions_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_revisions_answer_idx" ON "intake_revisions" USING btree ("intake_answer_id");--> statement-breakpoint
-- Hand-carried invariant (ADR-0014 §8): the intake edit-history ledger is append-only. UPDATE is
-- forbidden (revisions are new rows); DELETE stays permitted so the FK cascade from intake_answers
-- reclaims revisions on owner erasure (intake is never consented → no consent-scoped delete guard).
-- Reuses the shared chronicle_forbid_mutation() guard created in 0000_baseline, bound BEFORE UPDATE only.
CREATE TRIGGER intake_revisions_append_only BEFORE UPDATE ON intake_revisions FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();