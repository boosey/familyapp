# ADR-0008 Implementation Design — Deletion, erasure, and content-audio as artifact

Date: 2026-07-04
Status: Approved (design), pending implementation
Implements: `docs/adr/0008-deletion-erasure-and-content-audio-as-artifact.md` (amends ADR-0002)

## Goal

Make ADR-0008 executable across **all three** voice-origin content types (voice Story,
voice Ask, voice caption):

1. **Deletion is always available** — owner erases their own content; a steward may delete
   any content shared to a family they steward (moderation). No permanent-retention guarantee.
2. **Content audio is a permanent artifact while its item lives** — for any voice-origin item,
   the audio cannot be mutated or *detached*. The rendered/transcribed text is always backed by
   the original spoken source.
3. **Deletion cascades** — deleting the item deletes its content audio (and its ledger) with it.
   Audio has no independent lifecycle.
4. **Command audio is excluded** — voice used as UI control is neither retained nor protected
   (already true; no captured-command-audio model exists).

This is an **invariant / deletion** implementation. It models data, enforces triggers, and
provides audited write/delete paths. It does **not** build capture UI for voice Asks or voice
captions — no capture surface exists for them and that is outside ADR-0008.

## Key design decisions (locked with the author)

- **Hard-delete, not soft-delete.** Erasure is real: bytes are reclaimed. Honors the
  right-to-erasure baseline ("nothing retained against a user's will").
- **Separate append-only `erasure_audit` table.** The *fact* of a deletion (who, when, why)
  survives; the *content* (story/ask/caption + its audio + its consent-ledger rows) does not.
  The consent ledger is story-scoped, so it is cascade-deleted with the story — it cannot be the
  audit home for a deleted story.
- **Transaction-local cascade token.** The audited erasure repository sets
  `SET LOCAL chronicle.cascade_delete_item = '<itemId>'` at the top of the erasure transaction.
  Every relevant guard trigger carves out `DELETE` only when the token matches the row's owning
  item. Rationale: FK ordering forces child-first deletes (ledger rows before the story row), so
  the existing "is the parent still alive?" heuristic in the media trigger cannot work for
  `consent_records`. A session GUC is ordering-independent and, crucially, is *never* set by raw
  or accidental SQL — so structural protection stays intact against everything except the audited
  path.
- **Steward jurisdiction mirrors `decideAlbumPhotoManage`.** Owner may always erase their own
  item; a steward may delete an item **shared to a family they steward**. A truly private story
  shared to no family is **owner-only**.
  - OPEN POINT FOR REVIEW: ADR-0008 text literally says a steward may delete "a member's own
    Story," which could be read to include private, unshared stories. We default to the album
    precedent (jurisdiction = families the item is shared to). Flag if the ADR intent is broader.

## 1. Schema changes (`@chronicle/db` — `schema.ts`)

- **Voice Ask origin:** add `asks.recordingMediaId uuid → media.id` (nullable, `ON DELETE no
  action`). Present ⇒ voice-origin Ask; the referenced media is a protected content artifact.
- **Voice caption:** new table `voice_captions`:
  - `id uuid pk`
  - `photoId uuid → familyPhotos.id ON DELETE cascade` (a voice caption is a caption *on a photo*)
  - `mediaId uuid → media.id ON DELETE no action` (the protected audio artifact)
  - `transcript text` (the transcribed words; backed by `mediaId`)
  - `ownerPersonId uuid → persons.id`
  - `createdAt timestamptz default now()`
  - Distinct from the existing mutable, off-ledger `familyPhotos.caption` text field.
- **New media kind:** add `caption_audio` to `mediaKindEnum`.
- **Erasure audit:** new table `erasure_audit` (append-only; not FK-bound to erased content):
  - `id uuid pk`
  - `itemType text` — one of `story | ask | voice_caption | photo`
  - `itemId uuid` — the id of the erased item (NOT an FK; the row is gone)
  - `ownerPersonId uuid → persons.id` — who owned the erased content
  - `actorPersonId uuid → persons.id` — who performed the deletion
  - `reason text` — `owner_erasure | steward_moderation`
  - `at timestamptz default now()`

## 2. Trigger / invariant changes (`drizzle/invariants.sql` + new migration)

Helper: a small SQL function `chronicle_cascade_token_matches(item_id uuid) returns boolean`
reading `current_setting('chronicle.cascade_delete_item', true)`.

- **`chronicle_media_delete_guard` re-keyed** from *consent-scoped* to *item-existence-scoped*:
  - `UPDATE`: always forbidden (unchanged).
  - `DELETE`: forbidden if any **live parent** references the media —
    `stories.recording_media_id`, `story_recordings.media_id`, `asks.recording_media_id`,
    `voice_captions.media_id`, or `consent_records.approval_audio_media_id` — **unless** the
    cascade token matches the owning item, in which case allow. (Orphan media with no live parent
    remains freely deletable, as today.)
- **`consent_records` guard:** replace the blanket append-only DELETE ban with a cascade-token
  carve-out — `DELETE` allowed only when the token matches the row's `story_id`. `UPDATE` still
  always forbidden.
- **`prose_revisions` guard:** the current rule (DELETE allowed only if the owning story has no
  consent) is superseded by the cascade-token carve-out — `DELETE` allowed when the token matches
  the owning story. `UPDATE` still always forbidden.
- **`story_recordings` post-consent guard:** add the cascade-token carve-out so takes can be
  deleted as part of an authorized story erasure. `UPDATE`/re-aim still forbidden.
- The **kind⇔recording biconditional** (DEFERRABLE INITIALLY DEFERRED) is unaffected: erasing a
  story deletes it and its recordings together, so at commit there is no story to violate it.
- Every change is duplicated into a new `drizzle/migrations/00NN_adr0008_*.sql` with a matching
  `_journal.json` entry, so the drift-guard fingerprint (which hashes trigger + function bodies)
  matches between the snapshot and the migration chain.

## 3. Authorization + erasure path (`@chronicle/core`)

- **`decideItemDelete(db, ctx, item)`** in `authorization.ts` (mirrors `decideAlbumPhotoManage`):
  allow iff `ctx` is the item's owner OR the steward (`families.stewardPersonId`) of any family
  the item is shared to. Returns the existing `AuthDecision` shape.
- **New audited erasure repository** (new file, e.g. `packages/core/src/erasure-repository.ts`):
  - Entry points `eraseStory`, `eraseAsk`, `eraseVoiceCaption` (or one generic keyed by itemType).
  - Each: authorize via `decideItemDelete`; open a transaction; `SET LOCAL
    chronicle.cascade_delete_item`; cascade-delete in FK-safe order
    (children → `consent_records` → item row → content/approval `media`); insert the
    `erasure_audit` row; return `{ storageKeys }` for best-effort blob deletion by the caller
    (same pattern as `discardDraftStory`).
- **Architecture allowlist:** add the new erasure file to `packages/core/test/architecture.test.ts`
  ALLOWLIST in BOTH the enforcement scan and the sorted canary.

## 4. Testing (Vitest + PGlite; mirror `media-immutability-consent-scoped.test.ts`)

- **Trigger tests** (`@chronicle/db`):
  - `UPDATE` on media still always rejected.
  - Independent media `DELETE` rejected while a live parent references it (per parent type:
    story, story_recording, ask, voice_caption, consent approval-audio).
  - Cascade `DELETE` succeeds when the token is set to the owning item.
  - Raw `DELETE` without the token rejected even for consented/attached content (protection intact).
  - `consent_records` / `prose_revisions` / `story_recordings`: `UPDATE` rejected; `DELETE`
    rejected without token; `DELETE` allowed with matching token.
- **Repository tests** (`@chronicle/core`):
  - `eraseStory` / `eraseAsk` / `eraseVoiceCaption` remove item + audio + ledger, write one
    `erasure_audit` row with the right `reason`, and return the storage keys.
  - Non-owner / non-steward is rejected by `decideItemDelete`; steward of a shared family allowed.
- **Regression companion** for the ADR-0002 draft-discard path (`discardDraftStory`): must still
  succeed under the re-keyed trigger.

## 5. Documentation corrections

- Fix "immutable forever" wording in `docs/adr/0002-media-immutability-is-consent-scoped.md`,
  `CONTEXT.md`, and the `schema.ts` comments → "immutable and undetachable while the item lives;
  removed only when the item itself is deleted."
- Update `docs/adr/0008-*.md` status to note it is implemented (with a pointer to this spec).

## Out of scope

- Capture UI / write surfaces for voice Asks and voice captions.
- Any time-based sweep or reaper (ADR-0002 rejected this; unchanged).
- Command-audio capture/retention model (excluded by ADR-0008; none exists).
