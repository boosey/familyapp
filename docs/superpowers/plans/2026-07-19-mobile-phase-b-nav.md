# Plan — Mobile Phase B, part 1: native navigation & control IA

Owner decision record: [ADR-0025](../../adr/0025-mobile-phase-b-part-1-native-navigation-and-control-ia.md).
Builds on ADR-0024 (graceful-A). Mobile-only (`< 40rem` via `useIsCompact`); desktop unchanged.

## Shape (agreed)

- Bottom tab bar for the 4 primary tabs; sub-tab pills stay VISIBLE; secondary controls become
  per-concern labeled `lucide-react` icon sheets (**View** = layout only, **Family** = selector,
  **Filter** = search/facets); primary **action button iconified** on mobile; slim **collapse-on-scroll**
  top header keeps the family name for orientation.
- Out of scope (parked under ADR-0024): pinch-zoom, momentum/drag sheets, per-surface native modals.

## Verification gate — applies to EVERY increment

Real iOS Safari device · 393 + 360 (320 overflow spot-check) · multi-family seed (`VERCEL_ENV=preview`).
Named checks: (a) bottom bar clears home indicator (`safe-area-inset-bottom`), no Safari-toolbar
collision; (b) collapse-on-scroll no jank / no scroll-trap; (c) zero horizontal overflow at 360 with a
long family name; (d) hidden Filter → active badge round-trips. Mobile-first CSS (base = phone, desktop
layered at `min-width`). Devtools-green is NOT done.

---

## Increment 0 — remove the eyebrow (ships now, own PR)

- **Why:** cheap vertical win; not throwaway (the eyebrow is gone in Phase B regardless).
- **Files:**
  - `apps/web/app/hub/page.tsx` — delete the `<p className={styles.familyEyebrow}>…</p>` block
    (~lines 283–285) and its wrapping `<div>` if now empty.
  - `apps/web/app/_copy/hub.ts` — delete `shell.familyEyebrow`.
  - `apps/web/app/hub/page.module.css` — delete `.familyEyebrow`.
- **Dropped:** the standalone mobile `<h1>`-shrink (subsumed by Increment 2).
- **Done:** eyebrow absent 360/393; family-name `<h1>` still renders; `pnpm --filter @chronicle/web build`
  + web tests green. No test references the eyebrow today, so none to update.

## Increment 1 — bottom tab bar (load-bearing; lands first)

- **Goal:** on mobile, the 4 primary tabs render as a fixed bottom icon bar; the top `HubTabsNav` row is
  removed on the compact branch (desktop keeps it).
- **Approach:** new `_kindred`/hub `BottomTabBar` (fixed, `padding-bottom: env(safe-area-inset-bottom)`,
  lucide glyphs `BookOpen`/`Images`/`Users`/`MessageCircleQuestion`, `aria-current` on active). Gate its
  mount behind `useIsCompact`; hide the top tabs row on the same branch. Content region gets
  bottom padding = bar height + safe area so the last row isn't hidden behind the bar.
- **Watch:** iOS Safari toolbar collision; `100dvh` (not `100vh`); the bar must not overlap open
  bottom-sheets (z-index order with `BottomSheet`).
- **Guard test:** extend `responsive-breakpoints.test.ts` / add a structural test that the bottom bar
  mounts only compact and carries all 4 tab keys.

## Increment 2 — collapse-on-scroll top app-bar

- **Goal:** slim top bar (small family name + account avatar) visible at scroll-top, slides away on
  scroll-down, control strip stays sticky.
- **Approach:** scroll-direction hook (throttled; respects `prefers-reduced-motion` → no animate, just
  present); family name uses the existing `·`-joined multi-family string. Account avatar reuses the
  global `AccountMenuMount` (already fixed top-right) — reconcile so they don't double up.
- **Watch:** scroll-trap / rubber-band on iOS; the sticky control strip must not jump when the bar
  collapses (reserve/animate height).

## Increment 3 — control strip (per-icon sheets + iconified action)

- **Goal:** replace the single `MobileControlSheet` gear with visible sub-tab pills + `[View][Family]
  [Filter]` labeled icons + iconified action, per tab.
- **Approach:**
  - Generalize `MobileControlSheet` into a small `IconSheet` (label + lucide icon + optional badge +
    `BottomSheet` child), or render three `MobileControlSheet` instances with distinct label/icon.
  - Each tab's client surface (`StoriesSurface`, Album controls, `FamilyTab`, Questions) declares which
    of View/Family/Filter has content and routes its existing controls into the matching sheet:
    - View ← layout selector (Masonry/Column, Grid/List, tree zoom).
    - Family ← existing `FamilyChips` selector.
    - Filter ← `SearchField` + album date/facet/size + any per-tab facets.
  - Icons render only when their sheet has content (Questions → no View/Filter).
  - Action button: iconified on the compact branch (`✎`/`＋`/`👤+`), labeled on desktop.
- **Watch:** the 360px budget — pills + 3 labeled icons + icon-action must not overflow (the reason the
  action label yields); Family main-tab vs Family-selector glyph must differ.

## Increment 4 — per-icon active badges

- **Goal:** Family icon badges when selection is a subset; Filter icon badges when any filter is set;
  View unbadged.
- **Approach:** split the existing `controlActiveCount` logic in `StoriesSurface` (`searching`,
  `chipsFiltered`, non-default `feedView`) into per-icon signals; reuse for the other tabs.
- **Done (the gate's check d):** open Filter, set a filter, close → badge shows; clear → badge clears.

---

## Sequencing / delivery

- Increment 0: its own small PR now.
- Increments 1–4: Phase B PRs behind `useIsCompact`. Land + on-device-verify each before the next —
  small landable steps beat one big PR given Phase A's history. Bottom nav (1) is the dependency for the
  control strip (3), so keep the order.
