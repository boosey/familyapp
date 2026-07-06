-- ADR-0008: give `follow_up_decisions` the erasure-cascade carve-out the consent ledger already
-- has. The blanket append-only trigger (chronicle_forbid_mutation) forbade EVERY delete, so any
-- story that reached the follow-up loop (ADR-0013) could never be erased — the cascade in
-- eraseStory() raised "follow_up_decisions is append-only ... DELETE is not permitted". Replace the
-- trigger with a guard that still forbids UPDATE always, but permits DELETE only inside an
-- authorized erasure (when the transaction-local `chronicle.cascade_delete_story` token matches the
-- row's story_id). Hand-carried: drizzle-kit does not model triggers. Mirrors invariants.sql and
-- chronicle_consent_records_guard exactly. `chronicle_erasure_token_matches` already exists (0001).
CREATE OR REPLACE FUNCTION chronicle_follow_up_decisions_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF chronicle_erasure_token_matches(OLD.story_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'Table % is append-only/immutable: % is not permitted (the follow-up ledger is permanent outside an authorized item erasure).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS follow_up_decisions_append_only ON follow_up_decisions;
--> statement-breakpoint
CREATE TRIGGER follow_up_decisions_append_only
  BEFORE UPDATE OR DELETE ON follow_up_decisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_follow_up_decisions_guard();
