# ADR-0008 — Deletion, erasure, and content-audio as a permanent artifact (amends ADR-0002)

Status: Accepted (2026-07-01) — amends ADR-0002. Implemented 2026-07-04 (see docs/99-pruned/superpowers/specs/2026-07-04-adr0008-deletion-design.md).

## Context

ADR-0002 said consented audio stays "immutable **forever**" and the media trigger raises on *any*
`UPDATE`/`DELETE` of consented media. The photo/caption grill clarified that this was too strong and
too narrow at once: nothing should be retained against a user's will (right-to-erasure baseline),
and the real guarantee generalizes beyond Story.

## Decision

- **Deletion is always available.** A Person may delete their own content (erasure). A **steward may
  delete anything** in their Family, including a member's own Story or photo — moderation of
  inappropriate content is a first-class steward power. There is no permanent-retention guarantee.
- **Content audio is a permanent artifact of its item, while the item exists.** For *any* voice-origin
  **content** artifact — a voice Story, a voice question (**Ask**), a voice **caption** — the audio
  recording cannot be mutated or detached from its item. The rendered/transcribed text is always
  backed by the original spoken source; it is never swapped. This generalizes ADR-0002's Story-only
  rule to every content item that has a voice origin.
- **Deletion cascades.** Deleting the item deletes its content audio with it. Audio has no
  independent lifecycle — it is a child of exactly one item.
- **Command audio is excluded.** Voice used as UI control (e.g. "next photo", "next story") is not
  content and is neither retained nor protected as an artifact, even though it is captured audio.

## Consequences

- The media immutability trigger changes from "raise on any UPDATE/DELETE of consented media" to:
  forbid `UPDATE` always; forbid *independent* `DELETE` of content audio while its parent item
  exists; **allow** `DELETE` when it is part of the item's deletion cascade. ADR-0002's never-
  consented-draft deletion is unchanged.
- The steward gains a hard-delete capability over all family content — an authorization rule to
  implement through the audited front door and to record in the consent/audit trail.
- "Immutable forever" wording in ADR-0002 and `CONTEXT.md` is corrected to "immutable and
  undetachable while the item lives; removed only when the item itself is deleted."
