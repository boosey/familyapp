# Person-details panel: avatar + icon tooltips (#328)

Status: Design approved (2026-07-23)
Issue: #328 — "Person details panel redesign"
Surface: `apps/web/app/hub/tree/person-details.tsx` (+ `PersonDetails.module.css`)

## Scope

Issue #328 originally read "a lot of work in layout + update to Scrapbook theme." Owner review
(2026-07-23) narrowed it to exactly two changes; the layout/Scrapbook-reskin concerns were addressed
by other sessions (the sheet is already token-driven and re-skins under Scrapbook, kept intentionally
flat per #223).

The two remaining changes:

1. **Show the person's avatar** in the read-only view header.
2. **Add hover tooltips** to the four icon actions (Edit / Stories / Photos / Mentions).

Everything else about the panel — the edit form, invite affordance, placement/dismiss behavior,
editability probe, server actions — is **unchanged**. This is a `@chronicle/web`-only change; no core,
db, or schema changes.

## 1. Avatar

**Layout (owner-approved option A):** a horizontal header at the top of the read-only view — a
circular monogram avatar on the left, name + meta line stacked to its right. This de-cramps the top
without adding height (the sheet is 280px wide).

**Source:** reuse the existing, already-exported helpers from `person-node.tsx`:

- `monogramFor(node)` → the initial letter (`?` when nameless/anonymous).
- `monogramColor(node.personId)` → deterministic HSL from the personId hash (stable, render-order
  independent).

These are the same helpers the tree card uses, so the panel avatar matches the card avatar exactly
(same letter, same color). The photo branch (`imageUrl`) is not populated on `TreeNode` in v1, so in
practice the avatar is always a monogram — we render the monogram and do **not** add a photo path in
this change (the tree card's future photo support can be lifted later if a real image field lands).

**Size:** 52px (`AVATAR_SIZE_PX`, already a shared constant) — matches the tree card avatar.

**Anonymous bridge / nameless:** monogram shows `?`. The name stays italic (existing `titleAnon`).
No special avatar border needed in the panel (the dashed-border treatment is a tree-card affordance).

**Edit mode:** the avatar is part of the read-only header only. The edit form view is unchanged (it
has its own `formTitle` heading and no avatar). An unknown card opening straight into edit mode
(`startInEdit`) therefore shows no avatar until saved — unchanged behavior.

## 2. Icon tooltips

The four icon actions (Edit, Stories, Photos, Mentions) already carry `aria-label` (screen-reader
accessible). Add a native **`title`** attribute to each so a browser tooltip appears on hover.

- Values reuse the **existing copy strings** already used for the `aria-label`s
  (`hub.tree.editButton`, `hub.tree.detailsStories`, `hub.tree.detailsPhotos`,
  `hub.tree.detailsMentions`) — no new copy, single source, no i18n drift.
- Native `title` chosen over a styled tooltip component: lightest change, labels are short
  confirmations not critical info, and accessibility is already covered by `aria-label`.
- The Invite button is already text-labeled — no tooltip needed.

## Constants / copy discipline

No new numbers or strings. Avatar size reuses `AVATAR_SIZE_PX`; monogram color/geometry reuse the
existing `MONOGRAM_*` constants via `monogramColor`. Tooltip text reuses the existing `hub.tree.*`
copy strings. New CSS goes in `PersonDetails.module.css` as token-driven classes (`.header`,
`.avatar`, `.identity`), consistent with the file's existing style.

## Testing

Companion regression coverage in the existing `person-details` test suite:

1. **Avatar renders** — read-only view shows the monogram initial for a named node, and `?` for a
   nameless/anonymous node.
2. **Tooltips present** — each of the four icon actions has a `title` attribute equal to its label
   copy string.

Both assert against the real component (the suite already mounts `PersonDetails` with an injected
`checkEditable` seam). No full-suite rerun beyond the builder's red-green loop; CI settles pass/fail.

## Out of scope

- Any core/db/schema change.
- Real profile-photo support (no image field exists on `TreeNode` in v1).
- The edit form, invite flow, placement/dismiss logic.
- The tree card itself (`person-node.tsx`) — unchanged; we only consume its exported helpers.
