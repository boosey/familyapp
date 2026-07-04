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

-- Prose revisions: the prose provenance ledger (L1 user_authored/transcribed → L2 polished →
-- L3 corrected). Consent-scoped immutability, exactly like Media and the ordered take set
-- (ADR-0002/0007):
--   UPDATE → always forbidden (a correction is a NEW row, never an edit — the ledger is append-only).
--   DELETE → allowed ONLY when the owning Story has no consent_records row. Once a story is
--            approved/shared its prose lineage is frozen forever (it is the L2→L3 audit/diff
--            signal); but a never-consented draft that is being DISCARDED wholesale (ADR-0002) must
--            take its prose revisions with it. A text draft (ADR-0007) always carries a
--            `user_authored` L1, so without this carve-out a text draft could never be discarded.
CREATE OR REPLACE FUNCTION chronicle_prose_revision_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM consent_records WHERE story_id = OLD.story_id) THEN
    RAISE EXCEPTION
      'Cannot delete prose_revision %: its story has consent records; prose lineage is immutable after sharing.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prose_revisions_append_only
  BEFORE UPDATE OR DELETE ON prose_revisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_prose_revision_delete_guard();

-- Follow-up decision ledger: append-only (ADR-0013). Reuses the shared guard. A follow-up
-- OUTCOME is a NEW row referencing its decision, never an edit of the decision row.
CREATE TRIGGER follow_up_decisions_append_only
  BEFORE UPDATE OR DELETE ON follow_up_decisions
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

  -- DELETE: check (c) — ADR-0014 fork #2. Defense-in-depth + a consent-semantic error message for
  -- take-backing media. The FK (story_recordings.media_id NO ACTION) plus the
  -- story_recordings_post_consent_immutable trigger already prevent losing this audio; this check
  -- restates that invariant at the media layer and yields a consent-worded error instead of a raw
  -- FK violation. Covers position >= 1 takes AND typed-first mixed-take audio that check (b)'s
  -- recording_media_id pointer never sees.
  IF EXISTS (
    SELECT 1 FROM story_recordings sr
    INNER JOIN consent_records cr ON cr.story_id = sr.story_id
    WHERE sr.media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: it backs a take of a story with consent records. Consented take audio is immutable forever.',
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

-- Story takes are immutable AFTER approval (ADR-0012): a take may be dropped/re-recorded only
-- while the story has no consent records (pre-approval). Once the story is approved (a consent
-- row exists), the ordered take set is frozen — removable only by deleting the whole Story.
-- (UPDATE is left permitted so the transcribe step can backfill the derived transcript column;
-- the canonical AUDIO is protected by the media_immutable guard, not this one.)
CREATE OR REPLACE FUNCTION chronicle_story_recording_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM consent_records WHERE story_id = OLD.story_id) THEN
    RAISE EXCEPTION
      'Cannot delete story_recording %: its story has consent records; takes are immutable after approval.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_recordings_post_consent_immutable
  BEFORE DELETE ON story_recordings
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_recording_delete_guard();

-- ---------------------------------------------------------------------------
-- (1f) ADR-0014 §3: the kind ⇔ recording invariant for MIXED drafts (supersedes the ADR-0007
--      take-0-only CHECK). A draft is a live composition of interleaved voice + typed takes;
--      "any audio ⇒ voice". Enforced in two parts:
--        (a) a single-table CHECK for the text-half (needs no cross-table lookup);
--        (b) a DEFERRABLE INITIALLY DEFERRED constraint trigger for the voice biconditional,
--            checked at COMMIT so the audited repo may, within one tx, insert the first take and
--            flip kind in either order.
-- ---------------------------------------------------------------------------

-- (a) text ⇒ no canonical recording pointer. (voice MAY have a NULL pointer — a typed-first draft
--     that later gets a voice take keeps recording_media_id = NULL; its audio is the take set.)
ALTER TABLE stories ADD CONSTRAINT stories_text_no_recording_ck CHECK (
  NOT (kind = 'text' AND recording_media_id IS NOT NULL)
);

-- (b) The biconditional (kind = 'voice') ⟺ (EXISTS a story_recordings row for the story).
--     Deferred to COMMIT. The function is shared by triggers on BOTH stories and story_recordings
--     and re-derives the affected story id from whichever table fired. If the story no longer
--     exists (whole-draft discard deletes its takes AND the story in one tx), there is nothing to
--     enforce — return cleanly.
CREATE OR REPLACE FUNCTION chronicle_story_kind_recording_biconditional()
RETURNS trigger AS $$
DECLARE
  v_story_id uuid;
  v_kind story_kind;
  v_has_recording boolean;
BEGIN
  IF TG_TABLE_NAME = 'stories' THEN
    v_story_id := NEW.id;              -- fired on stories INSERT/UPDATE
  ELSE
    v_story_id := COALESCE(NEW.story_id, OLD.story_id);  -- story_recordings INSERT/DELETE
  END IF;

  SELECT kind INTO v_kind FROM stories WHERE id = v_story_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- story deleted in this tx (discard); nothing to enforce.
  END IF;

  v_has_recording := EXISTS (SELECT 1 FROM story_recordings WHERE story_id = v_story_id);

  IF (v_kind = 'voice') <> v_has_recording THEN
    RAISE EXCEPTION
      'story % violates the ADR-0014 kind/recording invariant: kind=%, has_recording=% (voice ⟺ ≥1 story_recordings row)',
      v_story_id, v_kind, v_has_recording
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger: return value ignored.
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER stories_kind_recording_biconditional
  AFTER INSERT OR UPDATE ON stories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();

-- Fires only on INSERT/DELETE (not UPDATE): a take's story_id is assumed IMMUTABLE — takes are
-- inserted and deleted, never re-parented to another story (moving a take between stories is not a
-- modeled operation), so the pair of affected stories can only change on those two ops. Covering
-- UPDATE would also be costly: a constraint trigger cannot take a WHEN clause, so an UPDATE variant
-- could not be scoped to story_id changes and would re-run the biconditional at COMMIT on every
-- transcript backfill — the hot path.
CREATE CONSTRAINT TRIGGER story_recordings_kind_recording_biconditional
  AFTER INSERT OR DELETE ON story_recordings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();

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

-- ---------------------------------------------------------------------------
-- (4) At most one COVER image per story (ADR-0009 accompaniment). A story has exactly one cover;
--     the write path (story-image-repository.ts) keeps this true by clearing every other image's
--     `is_cover` before setting the target (and by making the FIRST attached image the cover). This
--     partial unique index is the structural backstop the application logic can't express in
--     drizzle-kit — two rows with is_cover = true for the same story_id is impossible in the DB.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX story_images_one_cover_uq
  ON story_images (story_id)
  WHERE is_cover;
