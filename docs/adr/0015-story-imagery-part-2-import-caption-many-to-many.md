# ADR-0015 — Story imagery, part 2: import-not-sync, caption-is-a-label, many-to-many album

Status: Accepted (2026-07-03)

Amends ADR-0009 (story imagery / album topology) on three points and settles the three sub-features
ADR-0009 explicitly parked (suggestion/search, external source, photo-library integration). ADR-0009's
core stands: `family_photos` off the `media` immutability trigger, images off the consent ledger,
accompaniment vs subject relationships, bytes write-once, contributor-not-owner.

## Context

ADR-0009 designed the album but left three sizable sub-features ungrilled (OPEN-QUESTIONS:
"suggestion/search, external source, and photo-library integration"), and its text encoded two
assumptions this session overturned: that a **caption is a short Story**, and that the album is
**Family-scoped (singular)**. The grilling also hit an external reality that reshapes "connect Google/
Apple Photos," and a tension between ADR-0009 (singular album) and ADR-0010 (multi-family Stories).

## Decision

**1. There is no "photo-account connection" on web — only import, tagged by source.**
Google's broad Photos **Library API read scopes were removed in 2025** (403 for third parties); the
only sanctioned path is the **Picker API** (user picks items in Google's hosted picker; the app gets
short-lived access to just those items). Apple has **no web Photos API at all** (PhotoKit is native
iOS/macOS, on-device). Therefore:

- A photo enters the album by **import**, which always **copies bytes** into family object storage
  (write-once) and **never** stores a live reference to a remote library.
- `family_photos.source` (`upload` | `google_picker` | …) records provenance only; it changes nothing
  about the row afterward.
- **Google Photos** = a Picker import (no stored refresh token, no background sync, no whole-library
  browse). **Apple Photos** = the OS file picker (which already offers the device library), identical
  to `upload`. A true on-device PhotoKit integration is possible only inside a future native iOS app
  and is out of scope.

**2. A caption is a short LABEL on the photo, not a Story (reverses ADR-0009).**
`family_photos.caption` is contributor-authored free text ("Mardi Gras with friends, 1987"): mutable,
last-write-wins, **off every ledger**, editable at import / album browse / attach time, editable by
the **contributor or steward**. It doubles as **alt text** and is the primary human signal the
suggestion engine matches story text against. **Captioning a photo does NOT place it in a feed.** A
**Story from a photo** is a separate, deliberate act: an ordinary Story with `subject_photo_id` set —
full author/approval/consent path — and it is what lands in the stories feed. `subject_photo_id` is a
thin "what this is about" pointer; **all rendering flows through `story_images`** (a "start from a
photo" story also gets that photo as its first `story_images` row / default cover).

**3. Photo↔family is many-to-many (amends ADR-0009's "singular").**
Mirroring ADR-0010's multi-family Story targeting, a photo belongs to **one or more** family albums
via `family_photo_families(photo_id, family_id)`. The wedding *photo* can live in both Boudreaux and
Carney just as the wedding *story* can. Attaching a photo to a Story that targets a new family
**extends** the photo's album membership into that family — the contributor's deliberate attach+target
act being the consent. A photo still never escapes into families the contributor has not placed it in.
"In a family's album = consent for that family to see it" stays uniform, and album browse stays
consistent (no photo visible-through-a-story-but-absent-from-the-album split).

**4. Suggestion = EXIF-date + caption text now; vision later (premium).**
Suggestion is **ranking layered over an always-available browse-and-pick** — never a gate. v1 signals
are the photo's **caption text** and **EXIF capture-date proximity** to the story's `eraYear`; the
picker also just recency-orders. The system-initiated ("asked") attach is an **editor-time nudge**
("you mentioned the wedding — add a photo?"), the same engine framed as a prompt — **never a spoken
interviewer turn** (the voice loop stays photo-free). A `PhotoUnderstanding` vendor seam (vision model
→ caption/embedding) is reserved as an interface (mock only) for a later, likely subscription-gated
increment.

**5. Illustrations: schema seam only, feature deferred.**
`story_images.provenance` (`family_photo` | `illustration`) and the nullable inline illustration
columns ship, but only `family_photo` is reachable in the plan. No external image provider, license
capture, or "suggest a stock photo" UI until its own design pass.

## Consequences

- **Schema (rides the reseed workflow, single-schema policy — no migrations):** `family_photos`,
  `family_photo_families` (M2M), `story_images` (with reserved illustration cols), `stories.subject_photo_id`,
  `ask_subject_photos`. `mediaKind` `photo`/`document` seams stay vestigial (ADR-0009).
- **Authorization:** an audited image-read seam on the core allowlist. Photo-byte visibility =
  (album memberships) ∪ (audience of any *visible* item the photo is attached to); attachment/subject
  links are visible only when their parent item is (a private story must not leak its imagery/subject).
- **UI:** a Story with no attached image shows **no placeholder** — text-only cards are first-class.
- **Google Picker** is a vendor seam (adapter-isolated, per the SDK-only-in-adapters rule).
- **Still deferred (own design passes, per OPEN-QUESTIONS):** vision photo-understanding, external
  open-license illustrations, a photos-only / combined photo+story feed, depicted-third-party consent.

## Implementation status

Not yet built — see `docs/PLAN.md` "STORY IMAGERY (photos)" for the 5-phase sequence.
