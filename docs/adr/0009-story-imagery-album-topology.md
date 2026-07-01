# ADR-0009 — Story imagery: a shared family-photo album, distinct accompaniment vs subject relationships, off the consent ledger

Status: Accepted (2026-07-01)

## Context

Photos enter the product at story approval, album upload, and question creation. They must respect
the authenticity/consent spine without weakening the `media` audio invariant (ADR-0002/0008), and
the grill established that a photo relates to text in two different ways.

## Decision

**Album — a separate `family_photos` table, not `media`.** Every uploaded photo (any path: album,
story creation, Ask creation) lands in a Family-scoped album. A photo has a **contributor, not an
owner**; being in the album *is* consent for the family to see it (no `consent_records`). Chosen
separate from `media` on **lifecycle** grounds, not deletability: a photo lives independently,
attaches to many items (many-to-many), and is deletable on its own; audio is a single-owner child of
one item. Photo *bytes* are write-once in object storage (no silent pixel-swap); the *row* is
deletable by the contributor or the steward (ADR-0008). Not under the `media` immutability trigger.
`mediaKind` `photo`/`document` seams stay unused (vestigial).

**Two distinct relationships between a photo and text:**

- **Accompaniment** (`story_images` join) — pictures shown alongside a Story to illustrate it: many
  per story, one **cover**, ordered (`position`). Carries `provenance` (`family_photo` |
  `illustration`), a nullable `family_photo_id`, nullable inline illustration fields (`source_url`,
  `license`, `attribution`, `thumbnail_url`), and `attached_by_person_id`. **Illustrations** (external
  open-license images that make no authenticity claim) ride inline here — never in the album, since
  they are not shared, reusable, or family-owned.
- **Subject** — the photo the text is *about*. A **caption** is a short Story about one subject photo
  (`stories.subject_photo_id`, nullable FK, ≤1). An **Ask** may target one-or-more subject photos
  (`ask_subject_photos` join). Captions are legal as typed text because of ADR-0007 (text-origin
  Stories).

**Images are off the consent ledger.** Attaching/detaching/reordering/re-covering writes no
`consent_records` row and needs no re-approval, before or after sharing — images are mutable
presentation. (The *caption* is a Story and follows the normal approval/consent path; the *link* does
not.)

## Consequences

- Schema (behind the reseed workflow): add `family_photos`, `story_images`, `ask_subject_photos`, and
  `stories.subject_photo_id`. Deleting a photo cascades an un-attach everywhere it is used.
- **Authorization**: photo *bytes* are family-visible via the album (the existing family-tier
  active-membership check, routed through the audited front door). But *attachment and subject links*
  are visible only when their parent item is visible — a `private` Story's imagery/subject links must
  not leak the story's existence or subject. So the image read repository is an audited front-door
  path (core allowlist), not a free-for-all.
- Depicted-third-party consent is deferred (see `docs/OPEN-QUESTIONS.md`).
