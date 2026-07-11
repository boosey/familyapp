# ADR-0009 — Story imagery: album, import, captions, attachment, and suggestion

Status: Accepted (2026-07-01) · **Revised 2026-07-03** (clean rewrite consolidating the photo-library,
caption, and multi-family decisions that were originally grilled separately; supersedes the first-cut
"caption is a short Story" and "Family-scoped (singular)" wording of the 2026-07-01 version).

## Context

Photos enter the product at story creation, album upload, question (Ask) creation, and — on the
web — a Google Photos picker. They must respect the authenticity/consent spine without weakening the
`media` audio invariant (ADR-0002/0008). Grilling established that a photo relates to text in two
different ways, that "connecting a photo library" is not a real web capability, that a short photo
label is a distinct (lighter) thing than a story about a photo, and that a photo — like a Story
(ADR-0010) — can belong to more than one family.

## Decision

### The album — a separate `family_photos` table, not `media`

Every photo lands in a **Family album**: a shared, contributed-not-owned pool. A photo has a
**contributor, not an owner**; being in a family's album *is* the contributor's consent for that
family to see it (no `consent_records`). Separate from `media` on **lifecycle** grounds: a photo lives
independently, attaches to many items (many-to-many), and is deletable on its own; audio is a
single-owner child of one item. Photo **bytes are write-once** in object storage (no silent
pixel-swap); the **row is deletable** by the contributor or the steward (ADR-0008). Not under the
`media` immutability trigger. `mediaKind` `photo`/`document` seams stay vestigial.

### A photo belongs to one *or more* families (many-to-many)

`family_photo_families(photo_id, family_id)` — mirroring ADR-0010's multi-family Story targeting. The
wedding *photo* can live in both Boudreaux and Carney just as the wedding *story* can. Attaching a
photo to a Story that targets a new family **extends** the photo's album membership into that family
(the contributor's deliberate attach+target act being the consent). A photo never escapes into
families the contributor has not placed it in — NOT "anywhere in the system". "In a family's album =
consent for that family to see it" stays uniform; album browse stays consistent.

### Import, not sync — there is no "photo-account connection" on web

> **Revised 2026-07-11 (partially superseded).** The "no stored refresh token" clause below was
> overtaken by a shipped **connect-once Connection** model: Google Photos import now stores an
> *encrypted refresh token* (`google_photos_connections`) so the user authorizes once rather than
> per import. The load-bearing claim of this section still holds — import is **copy-bytes, not sync**:
> a Connection only mints short-lived Picker access; it grants **no background access and no
> whole-library browse**. See CONTEXT.md § **Connection** and ADR-0015.

A photo enters the album by **import**, which always **copies bytes** into family object storage and
**never** stores a live reference to a remote library. `family_photos.source`
(`upload` | `google_picker` | …) records provenance only.

- **Google Photos** = a **Picker** import: Google removed the broad Library-API read scopes in 2025
  (403 for third parties), so the only sanctioned path is the Picker API — the user picks items in
  Google's hosted picker and we copy those bytes. Backed by a connect-once **Connection** (an
  encrypted refresh token; see the revision note above) — but still no background sync and no
  whole-library browse.
- **Apple Photos** = the **OS file picker** (which already offers the device photo library); there is
  no web Photos API at all. Indistinguishable from an `upload`. A true on-device PhotoKit integration
  is possible only inside a future native iOS app and is out of scope.

### Caption is a short LABEL on the photo — not a Story

`family_photos.caption` is contributor-authored free text ("Mardi Gras with friends, 1987"):
**mutable, last-write-wins, off every ledger**, editable at import / album browse / attach time by the
**contributor or steward**. It doubles as **alt text** and is the primary human signal the suggestion
engine matches story text against. **Captioning a photo does NOT place it in any feed.**

### Two distinct relationships between a photo and text

- **Accompaniment** (`story_images` join) — pictures shown *alongside* a Story to illustrate it: many
  per story, one **cover**, ordered (`position`). Carries `provenance` (`family_photo` |
  `illustration`), a nullable `family_photo_id`, nullable inline illustration fields (`source_url`,
  `license`, `attribution`, `thumbnail_url`), and `attached_by_person_id`. **All rendering flows
  through `story_images`.** **Illustrations** (external open-license images that make no authenticity
  claim) ride inline here — never in the album. A Story with **no** attached image shows **no
  placeholder** — a text-only card is first-class.
- **Subject** — the photo the text is *about*. A **Story from a photo** is an ordinary Story with
  `stories.subject_photo_id` (nullable FK, ≤1) — a deliberate "tell the story of this photo" act,
  which is what lands in the stories feed; it also gets that photo as its first `story_images` row
  / default cover, and the interviewer's opener can be seeded from the caption. An **Ask** may target
  one-or-more subject photos (`ask_subject_photos` join). `subject_photo_id`/`ask_subject_photos` are
  thin "what this is about" pointers; they do not render on their own.

### Suggestion is ranking layered over browse — never a gate

A narrator can always browse the album and pick unaided. Ranking is additive. v1 signals: the photo's
**caption text** and **EXIF capture-date proximity** to the story's `eraYear` (the picker also just
recency-orders). Two editor-time surfacings, **never a spoken interviewer turn** (the voice loop stays
photo-free): a **silent** ranked candidate in the picker, and a **photo nudge** ("you mentioned the
wedding — add a photo?"), the *system-initiated* ("asked") counterpart to self-attaching. A
`PhotoUnderstanding` vendor seam (vision → caption/embedding) is reserved as an interface (mock only)
for a later, likely subscription-gated ranker.

### Images are off the consent ledger

Attaching / detaching / reordering / re-covering / captioning writes no `consent_records` row and
needs no re-approval — images are mutable presentation. (A **Story from a photo** *is* a Story and
follows the normal approval/consent path; the *link* and the *caption* do not.)

## Consequences

- **Schema (rides the reseed workflow; single-schema policy, no migrations):** add `family_photos`,
  `family_photo_families` (M2M), `story_images`, `stories.subject_photo_id`, `ask_subject_photos`.
  Deleting a photo cascades an un-attach everywhere it is used.
- **Authorization:** an audited image-read seam on the core allowlist. Photo-byte visibility =
  (album memberships) ∪ (audience of any *visible* item the photo is attached to); attachment/subject
  links are visible only when their parent item is (a `private` story must not leak its imagery or
  subject). Not a free-for-all — routed through the single front door.
- **Google Picker** is a vendor seam (adapter-isolated, per the SDK-only-in-adapters rule).
- **Build sequence:** `docs/PLAN.md` "STORY IMAGERY (photos)", a 5-phase plan.
- **Deferred to their own design passes** (see `docs/OPEN-QUESTIONS.md`): vision photo-understanding
  (premium tier), external open-license illustrations, a photos-only / combined photo+story feed, and
  depicted-third-party consent.
