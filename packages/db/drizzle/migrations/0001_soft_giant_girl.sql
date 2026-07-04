ALTER TYPE "public"."media_kind" ADD VALUE 'caption_audio' BEFORE 'photo';--> statement-breakpoint
CREATE TABLE "erasure_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_captions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"transcript" text,
	"owner_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "recording_media_id" uuid;--> statement-breakpoint
ALTER TABLE "erasure_audit" ADD CONSTRAINT "erasure_audit_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_audit" ADD CONSTRAINT "erasure_audit_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_captions" ADD CONSTRAINT "voice_captions_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_captions_photo_idx" ON "voice_captions" USING btree ("photo_id");--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_recording_media_id_media_id_fk" FOREIGN KEY ("recording_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-0008 invariants (hand-carried from invariants.sql; bodies must stay byte-identical for the
-- migration-drift fingerprint's md5(prosrc) to match the snapshot).
-- ADR-0008: the transaction-local cascade token. The audited erasure repository sets
-- `chronicle.cascade_delete_story` (LOCAL) to the id of the story it is erasing; the consent-ledger
-- guard consults this to permit DELETE only inside that authorized cascade. Unset → NULL → no match,
-- so raw/accidental SQL can never delete a consent row.
CREATE OR REPLACE FUNCTION chronicle_erasure_token_matches(p_story_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN current_setting('chronicle.cascade_delete_story', true) = p_story_id::text;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Media: existence-scoped content-artifact immutability per ADR-0008 (generalizes ADR-0002).
--   UPDATE → always forbidden (we never mutate audio bytes or their metadata).
--   DELETE → forbidden while ANY live parent references the audio: a story's canonical recording
--            pointer, a story take, a voice ask, a voice caption, or a consent approval-audio
--            reference. The audio is a permanent artifact WHILE ITS ITEM LIVES. Once the item (and
--            thus every reference) is gone, the orphan media row is reclaimable — that is how the
--            deletion cascade removes it. No token is needed here: reaching this delete requires the
--            referencing rows to be gone first, and those rows are themselves protected.
CREATE OR REPLACE FUNCTION chronicle_media_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Table % is append-only/immutable: % is not permitted (revisions must be new rows).',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM stories WHERE recording_media_id = OLD.id)
     OR EXISTS (SELECT 1 FROM story_recordings WHERE media_id = OLD.id)
     OR EXISTS (SELECT 1 FROM asks WHERE recording_media_id = OLD.id)
     OR EXISTS (SELECT 1 FROM voice_captions WHERE media_id = OLD.id)
     OR EXISTS (SELECT 1 FROM consent_records WHERE approval_audio_media_id = OLD.id)
  THEN
    RAISE EXCEPTION
      'Cannot delete media %: a live item references it. Content audio is an immutable artifact while its item exists (ADR-0008); it is removed only when the item itself is deleted.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- ADR-0008: the consent ledger is permanent EXCEPT within an authorized item erasure. A story that
-- is being erased must take its consent rows with it (nothing is retained against the owner's will);
-- the fact of the deletion is preserved separately in `erasure_audit`. UPDATE remains forbidden
-- always (a revocation is still a new superseding row, never an edit).
CREATE OR REPLACE FUNCTION chronicle_consent_records_guard()
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
    'Table % is append-only/immutable: % is not permitted (the consent ledger is permanent outside an authorized item erasure).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS consent_records_append_only ON consent_records;--> statement-breakpoint
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION chronicle_consent_records_guard();