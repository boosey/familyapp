# Album add/import redesign — "Add Photos" menu + files-first destination modal

**Date:** 2026-07-16
**Status:** Design — awaiting user review
**Surface:** `apps/web/app/hub/album/*` (primarily `AlbumUploader.tsx`, `AlbumSurface.tsx`,
`AlbumGrid.tsx` / `AlbumBoard.tsx`, `AlbumFilterBar.tsx`), copy in `apps/web/app/_copy/hub.ts`
**Origin:** `/wayfinder` session, user report "the album upload/import flow is horrible."

## Problem

The current album surface puts **two independent rows of family buttons** on screen at once, and
they look identical:

- **The browse FILTER** — `FamilyChips` (`AlbumSurface.tsx:152`, `FamilyChips.tsx`). Writes
  `?families=`, narrows *which photos are shown*. Legitimate, stays.
- **The upload/import DESTINATION designator** — `FamilyChoiceChips` inside a "Which albums?"
  fieldset in `AlbumUploader.tsx:460–493`. Local state, picks *which families a new photo is shared
  to*.

Two problems flow from this:

1. **The two chip rows are indistinguishable.** A user cannot tell that one is a filter and the
   other is a destination without trial and error. (Reported verbatim: "it took me a while to figure
   out one was a filter and the other was an add/import destination designator.")
2. **Destination is being used as a gate.** `addDisabled = busy || (showPicker && selected.size ===
   0)` (`AlbumUploader.tsx:284`) and the equivalent `importDisabled` (`:285–286`) leave the add/import
   buttons **disabled until a destination family is picked** — but the destination chips sit
   *outside* the add flow, so the buttons look broken for no visible reason. Destination is a detail
   *inside* the add/import action, not a precondition sitting on the toolbar.

Plus the three entry points (`Add to album`, `Import from Google Photos` / `Connect`, `Manage
connections`) are laid out inline and eat horizontal space.

## Destination (what this design achieves)

- **Only one standing family control on the surface**: the browse filter. The destination designator
  leaves the toolbar entirely.
- The three add/import/manage entry points collapse into **one right-justified `Add Photos` menu**,
  reclaiming screen space.
- Family destination is asked **at the moment of the action**, as a **files-first modal**, identical
  for upload and import — never as a standing gate.
- The existing **no-silent-fan-out safety guarantee is preserved** (a photo never quietly goes to
  every family); the enforcement simply moves from the toolbar to the modal's Add button.

Non-goal: no backend/storage/consent changes. The presigned direct-to-storage upload path (issue
#20) and the `familyIds` server-action contract are untouched — this redesign only changes *where and
when the client collects `familyIds`*.

## Decisions locked (wayfinder grilling, 2026-07-16)

| # | Decision |
|---|----------|
| D1 | Files-first modal: choose photos → modal asks destination → Add/Cancel. Not destination-first. |
| D2 | The modal has a **Cancel** — clean, because nothing is uploaded until Add (direct-to-storage fires on confirm). |
| D3 | Destination default is **filter-aware**: pre-select the family iff the browse filter is a single concrete family; blank otherwise (ambiguity ⇒ no default ⇒ no fan-out). Solo-family: their one family, always. |
| D4 | Import uses the **same modal, same timing** — Google picker returns chosen photos, *then* our destination modal. Symmetric with upload. |
| D5 | One right-justified **`Add Photos`** menu holding all three actions, with a **divider** separating the two add actions from `Manage connections`. |

## §1. The `Add Photos` menu (replaces the inline action row)

Right-justified trigger button labelled **Add Photos** (Kindred button, likely `secondary`/menu
style), opening a dropdown menu. Menu contents, top to bottom:

1. **`Add from your device`** — opens the OS file picker (the current hidden `<input type="file"
   multiple accept="image/*">` behaviour). Rendered only when `showFileUpload`.
2. **`Import from Google Photos`** *(connected)* / **`Connect Google Photos`** *(not connected)* —
   the current `runGoogleImport()` / `/api/google-photos/connect` behaviours. Rendered only when
   `googlePhotosConfigured`. The connect-vs-import label is chosen by
   `googlePhotosConnected`, exactly as today.
3. **— divider —**
4. **`Manage connections`** — the current `ManageConnectionsMenu` content (per-connection header +
   Disconnect). Rendered only when `googlePhotosConfigured && googlePhotosConnected`. Below the
   divider to signal "setup, not adding."

Menu placement: top-right of the album controls region, replacing the current inline button cluster
in `AlbumUploader.tsx:428–596`. The **browse FILTER chips stay where they are** (in
`AlbumFilterBar`'s consolidated row) — they are now the *only* standing family control, which
resolves the two-rows confusion by subtraction.

Edge states:
- **No add actions available** (no `showFileUpload` and not `googlePhotosConfigured`): the menu does
  not render at all (there is nothing to add).
- **View-only / no active families**: unchanged from today — a viewer who cannot contribute sees no
  add affordance. (Confirm current behaviour during build; do not newly grant an add path.)

## §2. The destination modal (the heart of the change)

A single reusable modal, used by both upload and import. Opens **after** photos are chosen (D1/D4).

**Contents:**
- **Title/prompt** referencing the concrete, already-chosen photos, e.g. *"Add these 4 photos to…"*
  (count-aware copy; see §4).
- **Destination picker**: the existing `FamilyChoiceChips` (multi-select) — same component, same
  multi-family capability as today. Rendered **only when the viewer has >1 family**; a solo-family
  viewer skips the modal's picker (see §3).
- **Primary `Add` button**: disabled until ≥1 family is selected. **This is the sole home of the
  no-fan-out rule** — the gate that used to live on the toolbar now lives here, where it is
  self-explanatory ("pick where these go before adding").
- **`Cancel`**: discards the pending file/photo selection and closes. No storage writes have
  happened, so there is nothing to clean up (D2).

**Default selection (D3):** when the modal opens, seed the picker as:
- Solo-family viewer → their one family (and skip the modal entirely, §3).
- Browse filter is a **single concrete family** → pre-select that family. The selection must be
  **visibly shown** so a pre-fill is never invisible (the user can see and override it before Add).
- Browse filter is `all` / `none` / a multi-family subset → **blank** (deliberate pick required).

This is the same ambiguity logic as `AlbumSurface.tsx:114–122` today, relocated to the modal open.
The server-side re-validation of `familyIds` against the caller's own active memberships
(`actions.ts` upload/import actions) is unchanged and remains the authority.

## §3. Solo-family and the "no modal needed" fast path

For a viewer in exactly one family, there is no destination question. The modal's picker does not
render and, ideally, the modal does not appear at all:

- **Upload (solo)**: `Add from your device` → OS file picker → upload straight to the one family.
  The server already auto-selects the sole family when no `familyIds` are sent
  (`actions.ts`), so the client may send none.
- **Import (solo)**: `Import from Google Photos` → Google picker → import straight to the one family.

Only multi-family viewers ever see the destination modal. This preserves the current
"solo-family contributors see no chips" behaviour, now stated as "solo-family contributors see no
modal."

## §4. Copy changes (`apps/web/app/_copy/hub.ts`, album section ~lines 346–561)

Per project convention, all user-facing text is externalized. Changes:

- **New**: `addPhotosMenu` — the menu trigger label, "Add Photos".
- **Repurpose**: `addButton` ("Add to album") → becomes the menu item `Add from your device`
  (or add a new `addFromDevice` key; retire the toolbar meaning).
- **New**: destination-modal title as a **count-aware arrow fn**, e.g.
  `addToDestination: (n: number) => \`Add ${n} photo${n === 1 ? "" : "s"} to…\`` and the import
  variant, following the existing dynamic-string-as-arrow-fn pattern (cf. `photosPartial()`,
  `googlePhotosPartial()`).
- **New**: modal `Cancel` label (reuse a shared cancel key if one exists).
- **Keep**: `googlePhotosConnect`, `googlePhotosImport`, `manageConnections`,
  `googlePhotosDisconnect`, all error/partial-success strings — same text, new home (menu items /
  modal).
- **Retire**: `chooseAlbums` ("Which albums?") as a *fieldset legend*; the concept moves into the
  modal title. (Reuse the string as the picker's aria-label if useful.)

No new tunable numeric constants. `PHOTO_BATCH_MAX_FILES` (30) and the picker poll constants are
unchanged.

## §5. What does NOT change (guardrails for the builder)

- **Storage / server actions**: `uploadAlbumPhotoAction`, `uploadOneAlbumPhotoAction`,
  `startGooglePhotosImportAction`, `pollGooglePhotosImportAction`, `listGooglePhotosImportAction`,
  `importOneGooglePhotoAction`, and `createAlbumPhoto` keep their signatures. The client still
  appends `familyIds` to FormData exactly as now — only the *UI that collects the Set* moves into the
  modal.
- **The no-silent-fan-out invariant** (`AlbumSurface.tsx:114–122`) must survive the move. Regression
  coverage: a multi-family viewer with an `all`/multi filter must be unable to complete an add
  without an explicit destination pick (assert the modal Add stays disabled at `selected.size === 0`).
- **Board mode (F2 flag)** per-item vs batch dispatch is unchanged; both read the destination Set
  produced by the modal before dispatch.
- **The browse FILTER** (`FamilyChips`, `?families=`) is untouched in behaviour and placement.

## §6. Build notes

- `AlbumUploader.tsx` loses its standing `FamilyChoiceChips` fieldset and inline button row; gains
  the `Add Photos` menu trigger + the destination modal (or a new `AddPhotosMenu` + `DestinationModal`
  child, TBD by the builder — extracting the modal is recommended since upload and import share it).
- The designator `selected` Set moves from persistent component state to **modal-scoped state**,
  seeded on each open per §2.
- **Focus management / a11y**: the destination modal is a real dialog — focus trap, `Escape` =
  Cancel, labelled title, restore focus to the menu trigger on close. The `Add Photos` menu follows
  the existing `ManageConnectionsMenu` keyboard pattern.
- **Regression tests** (repo convention — companion test after behaviour change):
  1. No-fan-out: multi-family + ambiguous filter ⇒ modal Add disabled until a pick.
  2. Filter-aware default: single-concrete-family filter ⇒ that family pre-selected on open.
  3. Solo-family: no modal; upload/import proceeds directly.
  4. Cancel: closes with zero storage writes (no `familyIds` dispatched).

## Open items deferred (not blockers)

- Drag-and-drop onto the album as an add path — not present today, out of scope.
- Additional import sources beyond Google Photos — the menu structure accommodates more items above
  the divider, but none are in scope now.
