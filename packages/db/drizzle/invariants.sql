-- Structural invariants that drizzle-kit does not model. Applied right after schema.sql (the
-- generated table DDL) on every fresh/reset database. These are the load-bearing guarantees of
-- Phase 0, enforced in the database itself so no application bug — and no future query path — can
-- bypass them. Hand-maintained (schema.ts can't express triggers or partial-WHERE indexes).

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

-- Media: consent-scoped immutability per ADR-0002.
--   UPDATE  → always forbidden (we never mutate audio bytes or their metadata).
--   DELETE  → allowed ONLY when neither the media row nor its owning Story is linked to any
--             consent_records row.  The recording clip AND the approval-audio clip of any
--             approved/shared story stay immutable forever; never-consented draft takes may
--             be reclaimed.
-- A single function handles both ops via TG_OP so one trigger covers both.
CREATE OR REPLACE FUNCTION chronicle_media_delete_guard()
RETURNS trigger AS $$
BEGIN
  -- UPDATE is unconditionally forbidden.
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: check (a) — is this media row referenced directly by any consent record?
  IF EXISTS (
    SELECT 1 FROM consent_records WHERE approval_audio_media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: it is referenced by a consent record (approval_audio_media_id). Consented media is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: check (b) — does this media's owning Story (recording_media_id = OLD.id) have
  -- any consent_records row?  If so, the recording is part of the audit trail and must stay.
  IF EXISTS (
    SELECT 1 FROM stories s
    INNER JOIN consent_records cr ON cr.story_id = s.id
    WHERE s.recording_media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: its owning story has consent records. Story recording media is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_immutable
  BEFORE UPDATE OR DELETE ON media
  FOR EACH ROW EXECUTE FUNCTION chronicle_media_delete_guard();

-- The canonical recording pointer is itself immutable. The consent-scoped media guard above
-- protects a media row from deletion while its owning Story has consent records — but that link
-- is `stories.recording_media_id`. If that pointer could be re-aimed at a different media row,
-- a consented story's original recording would become an orphan and the guard would then permit
-- its deletion. So we forbid CHANGING `recording_media_id` once set, in the database, independent
-- of any application write path. (Every other column on `stories` — state, tier, derived prose,
-- etc. — stays freely mutable; this trigger fires ONLY when the recording pointer actually
-- changes.) This matches the data model: "Media is created first, then the Story points at it",
-- and the pointer never moves.
CREATE OR REPLACE FUNCTION chronicle_story_recording_pointer_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.recording_media_id IS DISTINCT FROM OLD.recording_media_id THEN
    RAISE EXCEPTION
      'stories.recording_media_id is immutable (the canonical recording pointer never moves): % -> %',
      OLD.recording_media_id, NEW.recording_media_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stories_recording_pointer_immutable
  BEFORE UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_recording_pointer_immutable();

-- ---------------------------------------------------------------------------
-- (2) At most one ACTIVE membership per (person, family). Ended/paused rows may coexist, so a
--     person can leave and rejoin a family over time without violating this. A partial unique
--     index is the right tool; drizzle-kit cannot express the WHERE clause.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX memberships_one_active_per_family_uq
  ON memberships (person_id, family_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- (3) At most one PENDING join request per (family, requester). Approved/declined rows may
--     coexist, so a requester whose earlier request was declined can ask again later. The partial
--     unique index also closes the phantom-read race a transaction alone cannot under READ
--     COMMITTED: two concurrent createJoinRequest calls both SELECT "no pending" and both INSERT —
--     the index makes the second INSERT fail (mapped in the repository to the existing "a pending
--     request already exists" InvariantViolation). See ADR-0001.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX join_requests_one_pending_uq
  ON join_requests (family_id, requester_person_id)
  WHERE status = 'pending';
