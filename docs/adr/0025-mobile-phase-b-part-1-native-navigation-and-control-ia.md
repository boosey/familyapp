# ADR-0025 — Mobile Phase B, part 1: native navigation & control IA

Status: Accepted (amended 2026-07-21)

Supersedes the "park B" stance of [ADR-0024](0024-responsive-mobile-pass-graceful-a-now-native-b-later.md)
for the **navigation + control** slice of B only. ADR-0024's other parked B items (pinch-zoom on the
tree, real drag/momentum bottom-sheets, per-surface native modals) stay parked and are explicitly out
of scope here. Relates to #230 and the `RESPONSIVE_BREAKPOINTS_REM` guard
(`app/_kindred/responsive-breakpoints.test.ts`). Progressive control-row amendment relates to #296 /
#298.

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
*(secondary control-chrome clauses — per-concern sheets, always-visible sub-tabs, desktop two-row
toolbar — superseded for Stories/Album; see Amendment 2026-07-21. Primary nav IA unchanged.)*

Load-bearing choices (in dependency order):

- **Bottom tab bar first.** The 4 primary tabs (Stories · Album · Family · Questions) move from the top
  `HubTabsNav` to a fixed bottom icon bar on mobile. This is the load-bearing IA move and the first
  increment, because it is what frees the top and makes the rest of the control layout coherent.

- **Sub-tabs stay VISIBLE.** Sub-tab pills (Feed/Timeline; the Questions sub-nav; Family's
  tree/list/requests) are primary wayfinding, not a view preference — they remain visible inline. They
  are NOT hidden behind an icon. (The earlier "fold sub-tabs into a view icon" idea is rejected: it
  hides where-am-I to save space the bottom-bar move already reclaimed.)
  *(superseded for Stories/Album — see Amendment 2026-07-21; Family/Questions sub-tabs stay visible
  inline until a follow-up)*

- **Per-concern control icons, not one gear.** The single `⚙ Filters & view` sheet splits into up to
  three labeled icon triggers, each opening its own `BottomSheet`:
  - **View** — layout options ONLY (Masonry/Column, Grid/List, tree zoom). No badge (a layout choice
    hides no content). Renders only where a tab actually has layout options.
  - **Family** — the existing family selector. Badged when the selection is a *subset* (not "all").
  - **Filter** — search + facet filters for the active sub-tab/view. Badged when any filter is set.
  A tab renders only the icons that have content (e.g. Questions has no View/Filter → neither renders).
  *(superseded for Stories/Album — see Amendment 2026-07-21; Family/Questions keep this model until
  a follow-up)*

- **Labeled icons + iconified action.** Icons carry a tiny text label (bare glyphs for "view"/"family"
  test as ambiguous). To fit the 360px floor alongside visible sub-tab pills, the primary **action
  button is iconified** (`Tell`→✎, `Add photos`→＋, `Invite`→👤+); it keeps its label on desktop. The
  360px budget was the deciding constraint — labeled icons + a text action button overflow, so the
  action label is what yields.
  *(Stories/Album: primary actions stay outside progressive-collapse precedence and may iconify
  under width pressure — including on wide viewports when the trailing action must shrink — see
  Amendment 2026-07-21. Clarity bet on labeled collapsed icons remains. Family/Questions keep the
  prior compact-iconify / desktop-label split until a follow-up.)*

- **Collapse-on-scroll top bar.** A slim top app-bar (small family name + account avatar) shows at
  scroll-top and slides away as the viewer scrolls into content. This is what actually delivers
  reclaimed vertical space rather than relocating chrome. The family name is NOT dropped entirely — it
  still orients multi-family (`·`-joined) viewers when they land.
  - **Amendment (2026-07-20, post Increment-2 device rounds): the control strip is NON-sticky** — it is
    normal top-matter that scrolls away with the content (scroll back up to reach filters/sub-tabs).
    The original "strip stays sticky" was reversed by the owner: a second sticky element coexisting with
    the `transform`-collapsing header is exactly the interaction that caused two of Increment 2's three
    on-device bugs (a `transform` ancestor becomes the containing block for `position:fixed`/sticky
    descendants; two `top:0` stickies fight). Primary nav (the fixed bottom bar) is always reachable, so
    the strip need not be. Revisit stickiness as a later polish once the icon sheets are proven.

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
  *(shipped as prior model; Stories/Album progressive row replaces this — see Amendment 2026-07-21)*
- **4:** per-icon Family + Filter active badges (View unbadged).
  *(Stories/Album badge semantics per Amendment 2026-07-21 — Search/Filters split, Views unbadged)*

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
  *(Stories/Album progressive row supersedes the fixed three-icon strip — see Amendment 2026-07-21)*
- Desktop is untouched (top tabs + inline `HubToolbar`), so the mobile branch is additive behind
  `useIsCompact`; regression risk is confined to the compact path.
  *(superseded — see Amendment 2026-07-21; for Stories/Album secondary browse chrome only. Desktop
  top primary tabs and the compact bottom tab bar remain. Family/Questions keep the prior
  toolbar/strip until a follow-up.)*
- Phase B remains incomplete after this: pinch-zoom, momentum sheets, and native modals are still owed
  under ADR-0024.

## Amendment 2026-07-21 — Progressive hub control row (Stories + Album)

Relates to #296 / #298. Primary navigation IA from this ADR is **unchanged**: bottom tab bar on
compact, top primary tabs on wide, collapse-on-scroll header, compact breakpoint for primary nav, and
the non-sticky control strip (2026-07-20) still stand. This amendment replaces only the secondary
browse **control-chrome** rules that assumed a binary compact strip vs desktop two-row toolbar and
that forbade collapsing Sub tabs behind an icon.

### Decision

One **progressive-collapse control row** on every width for Stories and Album. Browse controls share a
vocabulary; each present unit expands to its fullest form when there is room; when space runs out,
lower-precedence units collapse to icons first. Phone vs wide changes only the shell for collapsed
panels (bottom sheet vs anchored popover), not which controls exist.

- **Shared vocabulary with occupancy.** Units: **Sub tabs**, **Family**, **Search**, **Filters**,
  **Views**. A surface omits units it does not have (e.g. Stories has no Filters; Album has no Sub
  tabs; single-family viewers have no Family). Do not invent empty chrome for vocabulary symmetry.

- **Expansion precedence** (highest claim first): Sub tabs → Family → Search → Filters → Views.
  Collapse in reverse. Views collapse first when space is scarce.

- **Sub tabs three stages:** (1) labeled pills; (2) iconized pills as an inline group; (3) single
  menu icon that opens a Feed/Timeline (etc.) menu. Other units are binary: full inline or collapsed
  icon → panel. While deciding which secondaries stay expanded, always choose the richest Sub-tabs
  stage that fits with the current set; the **menu-icon stage is allowed only after every present
  lower-precedence unit is collapsed** (or absent).

- **Open patterns.** Sub tabs menu-icon → menu (not a sheet). Family / Search / Filters / Views →
  bottom sheet on compact viewports, anchored popover on wide viewports; panel body content is shared.

- **Primary actions outside collapse.** Tell / Add Photos reserve trailing width and sit outside
  expansion precedence; they may iconify under width pressure. They do not compete with
  Sub tabs → Views expansion math.

- **Search vs Filters.** Stories collapsed search is labeled and presented as **Search** (not Filter).
  Album keeps Search and Filters as separate units when facets exist. Filters collapse before Search
  when both cannot stay expanded.

- **Badging.** Collapsed Family badges when the selection is a subset. Collapsed Search / Filters
  badge when refinement is active. Views do **not** badge merely for the current layout.

- **Measuring / seam.** The row observes available width and uses measured natural widths of each unit
  form (including Sub-tabs stages) plus reserved action width as inputs to a pure
  `resolveHubControlExpansion` resolver. Component wiring stays thin; CSS/breakpoint booleans are not
  the behavior seam for precedence.

- **Scope.** Stories and Album only in this wave. Family and Questions stay on the existing
  toolbar/strip until a follow-up adopts the same primitive. Keep the two-row toolbar component
  available for those tabs; Stories/Album must not depend on the old two-row composition.

- **Clarity.** Accessible names for collapsed icons and the Sub tabs menu; labeled collapsed icons
  where ambiguity requires it (same clarity bet as the original icon-sheet work).

### Consequences

- Mobile and desktop stop maintaining two separate control IAs for Stories/Album; mid-widths fold
  gradually by priority instead of swapping chrome.
- Implementers must treat the superseded bullets above as historical; the Amendment is authoritative
  for Stories/Album secondary browse chrome.
- Family/Questions migration and sticky-row revisit remain follow-ups; parked ADR-0024 items stay
  parked.
