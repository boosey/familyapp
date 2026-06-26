-- Structural invariants that drizzle-kit does not model. Applied after the generated table
-- DDL (0000_init.sql). These are the load-bearing guarantees of Phase 0, enforced in the
-- database itself so no application bug — and no future query path — can bypass them.

-- ---------------------------------------------------------------------------
-- (1) Append-only / immutable rows. A single guard function raises on any UPDATE or DELETE.
--     Used for the consent ledger (revocation = a NEW superseding row, never an edit) and for
--     Media (the canonical recording is never overwritten or lost; new versions are new rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION chronicle_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- The consent ledger: no UPDATE, no DELETE. Ever.
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();

-- Media: immutable. This is what makes it STRUCTURALLY IMPOSSIBLE for a synthesis step to
-- write back over the original recording — even a buggy one. Derived prose/transcript live on
-- the `stories` row (mutable); the audio bytes' metadata row can never change.
CREATE TRIGGER media_immutable
  BEFORE UPDATE OR DELETE ON media
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();

-- ---------------------------------------------------------------------------
-- (2) At most one ACTIVE membership per (person, family). Ended/paused rows may coexist, so a
--     person can leave and rejoin a family over time without violating this. A partial unique
--     index is the right tool; drizzle-kit cannot express the WHERE clause.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX memberships_one_active_per_family_uq
  ON memberships (person_id, family_id)
  WHERE status = 'active';
