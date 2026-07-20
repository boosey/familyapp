# ADR-0025 — Mobile Phase B, part 1: native navigation & control IA

Status: Accepted (2026-07-19)

Supersedes the "park B" stance of [ADR-0024](0024-responsive-mobile-pass-graceful-a-now-native-b-later.md)
for the **navigation + control** slice of B only. ADR-0024's other parked B items (pinch-zoom on the
tree, real drag/momentum bottom-sheets, per-surface native modals) stay parked and are explicitly out
of scope here. Relates to #230 and the `RESPONSIVE_BREAKPOINTS_REM` guard
(`app/_kindred/responsive-breakpoints.test.ts`).

## Context

ADR-0024 did approach A (graceful responsive reflow, same DOM + same navigation) and deferred B
(native mobile UX) to "a later ticket … revisit when B is scheduled." That ticket is now scheduled.

Approach A landed but kept fighting the medium: even after the recent mobile passes (compact hub tabs,
the single `⚙ Filters & view` `MobileControlSheet`, the `/s` capture surface), the phone still stacks a
family eyebrow + a large family-name `<h1>` + a top primary-tab row + a control toolbar before any
content appears. The remaining wins are not more reflow tuning — they are an information-architecture
change: move primary navigation to the bottom (the mobile idiom), and reclaim the top.

A distinction that shaped this ADR: the earlier proposal framed the whole change as "save vertical
space," but the single `⚙` gear already collapses the secondary controls to one row. Splitting that gear
into per-concern icons does **not** save vertical space — it is a *clarity* bet. The genuine vertical
wins are (a) deleting the eyebrow and (b) vacating the top tab row to the bottom bar. This ADR keeps the
two motivations honest so the icon work is justified on legibility, not on a space claim it doesn't
deliver.

## Decision

**Un-park the navigation + control slice of B. Move primary nav to a bottom tab bar, reclaim the top
with a collapse-on-scroll header, and expose secondary controls as per-concern labeled icon sheets —
while keeping sub-tab wayfinding visible.** Mobile-only (`< 40rem` via `useIsCompact`); desktop keeps
today's top tabs + inline `HubToolbar` unchanged.

Load-bearing choices (in dependency order):

- **Bottom tab bar first.** The 4 primary tabs (Stories · Album · Family · Questions) move from the top
  `HubTabsNav` to a fixed bottom icon bar on mobile. This is the load-bearing IA move and the first
  increment, because it is what frees the top and makes the rest of the control layout coherent.

- **Sub-tabs stay VISIBLE.** Sub-tab pills (Feed/Timeline; the Questions sub-nav; Family's
  tree/list/requests) are primary wayfinding, not a view preference — they remain visible inline. They
  are NOT hidden behind an icon. (The earlier "fold sub-tabs into a view icon" idea is rejected: it
  hides where-am-I to save space the bottom-bar move already reclaimed.)

- **Per-concern control icons, not one gear.** The single `⚙ Filters & view` sheet splits into up to
  three labeled icon triggers, each opening its own `BottomSheet`:
  - **View** — layout options ONLY (Masonry/Column, Grid/List, tree zoom). No badge (a layout choice
    hides no content). Renders only where a tab actually has layout options.
  - **Family** — the existing family selector. Badged when the selection is a *subset* (not "all").
  - **Filter** — search + facet filters for the active sub-tab/view. Badged when any filter is set.
  A tab renders only the icons that have content (e.g. Questions has no View/Filter → neither renders).

- **Labeled icons + iconified action.** Icons carry a tiny text label (bare glyphs for "view"/"family"
  test as ambiguous). To fit the 360px floor alongside visible sub-tab pills, the primary **action
  button is iconified** (`Tell`→✎, `Add photos`→＋, `Invite`→👤+); it keeps its label on desktop. The
  360px budget was the deciding constraint — labeled icons + a text action button overflow, so the
  action label is what yields.

- **Collapse-on-scroll top bar.** A slim top app-bar (small family name + account avatar) shows at
  scroll-top and slides away as the viewer scrolls into content; the control strip stays sticky. This
  is what actually delivers reclaimed vertical space rather than relocating chrome. The family name is
  NOT dropped entirely — it still orients multi-family (`·`-joined) viewers when they land.

- **Icon set: `lucide-react`.** Already installed and already the `_kindred` icon primitive
  (`KindredListenBar`, `KindredVoiceButton`). Inline SVG React components, stroked with `currentColor`
  (theme-inherited), self-contained (no web font / no external request — consistent with the app's
  no-CDN ethos). Material Symbols was considered and rejected: it would add a redundant second icon
  vocabulary (web font + CSP, or a second SVG package) for no gain over the set already in use.
  Candidate glyphs: `LayoutGrid`/`Rows3` (view), `Users`/`UsersRound` (family), `ListFilter`/
  `SlidersHorizontal` (filter); bottom bar `BookOpen` (Stories), `Images` (Album), `Users` (Family),
  `MessageCircleQuestion` (Questions). Note the Family main-tab vs Family-selector glyph collision —
  differentiate them (distinct glyph or state) so they don't read as the same control.

- **Mobile-first CSS, per ADR-0024.** Base (no-media-query) styles target the phone; desktop is layered
  back at `min-width` so the `min-width`-only guard test stays meaningful. No new breakpoint unless a
  surface forces it (flagged, not silent). Targets: design 393px, hard floor 360px, spot-check 320px
  for no-overflow only.

- **Explicitly OUT of scope (still parked under ADR-0024):** pinch-zoom on the tree, real drag/momentum
  bottom-sheets (the current `BottomSheet` tap-to-open is reused as-is), and per-surface native modals.
  Naming these keeps the next contributor from reading "Phase B" as finished.

## Increments (each independently shippable AND verified on-device)

- **0 (ships now, own PR):** delete the "Your Family …" eyebrow. The standalone mobile `<h1>`-shrink is
  dropped — the collapse-on-scroll header (Increment 2) subsumes it, so shrinking it now is throwaway.
- **1:** bottom tab bar (mobile replaces top `HubTabsNav`).
- **2:** collapse-on-scroll top app-bar (family name + account avatar).
- **3:** control strip — visible sub-tab pills + `[View][Family][Filter]` labeled lucide icons +
  iconified action, per tab; split `MobileControlSheet` into per-icon sheets.
- **4:** per-icon Family + Filter active badges (View unbadged).

## Verification gate (definition of done for EVERY increment)

The pattern that has burned this project is "green in Chrome devtools, broken on the phone" (a prior
false "done": Chrome@393 passed, a real iPhone-16 showed tab wrap + vertical bloat). Fixed-position
bottom bars, `safe-area-inset`, and collapse-on-scroll are precisely the things that only reproduce on
real iOS Safari. Therefore no increment is "done" on devtools alone:

- **Real iOS Safari device** (owner has one), not just emulation.
- **393 and 360 widths**, plus a **320 spot-check for horizontal overflow only**.
- **Multi-family seeded data** (≥2 families so Family/Filter badges render and the `·`-joined name
  exercises the collapse header); seed via `VERCEL_ENV=preview`.
- **Named failure checks** — not "looks fine": (a) bottom bar clears the iOS home indicator
  (`safe-area-inset-bottom`) and does not collide with Safari's toolbar; (b) collapse-on-scroll neither
  janks nor traps scroll; (c) control strip has **zero horizontal overflow at 360** with a long family
  name present; (d) opening a hidden Filter and returning shows the active badge.

## Consequences

- Bottom nav is a native idiom imported into mobile web: it inherits `safe-area-inset`, iOS-Safari
  toolbar-collision, and fixed-position scroll concerns. These are standard-CSS-solvable but are real
  work — this is the part of Phase B that is not free, and the on-device gate exists to catch it.
- Splitting one gear into three icon sheets adds control surface (three triggers, three sheets) whose
  payoff is legibility, not pixels. Accepted deliberately; revisit if on-device testing shows the trio
  is fussier than the single gear it replaces.
- Desktop is untouched (top tabs + inline `HubToolbar`), so the mobile branch is additive behind
  `useIsCompact`; regression risk is confined to the compact path.
- Phase B remains incomplete after this: pinch-zoom, momentum sheets, and native modals are still owed
  under ADR-0024.
