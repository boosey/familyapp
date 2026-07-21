# Mobile responsive baseline — 393×852 (iPhone 16), 2026-07-19

Captured via a throwaway Playwright spec (`e2e/_baseline-capture.spec.ts`, deleted before PR) driving
the hermetic e2e server at a 393px viewport, signed in as the seeded narrator. Full-page screenshots
of 12 in-scope surfaces. This is the ground truth the ADR-0024 mobile pass fixes against.

## Headline finding (honest reframe)

**The app is NOT "unusable" at 393px.** The intrinsic layout (clamp / flex / single-column forms)
already carries most surfaces well. "Everything wraps" overstates it. Two illusions inflated the
impression:

1. **The bottom-left dark "N" bubble is the Next.js dev-mode indicator**, not our UI. It overlaps
   content (e.g. story-detail prose) only under `next dev`; it does not ship to production. Discount
   it entirely.
2. A handful of **toolbar right-slot items floating with dead gutters** read as "broken layout" at a
   glance, but the surrounding content is fine.

Surfaces that already read WELL single-column and need little/no work: story detail (`/hub/stories/[id]`),
compose (`/hub/tell`), families/new, settings, profile, the story feed cards.

## Real offenders (what the pass actually fixes)

| # | Surface(s) | Offender | Root cause |
|---|-----------|----------|------------|
| 1 | Stories, Album toolbars | Action buttons (Tell a story, Add Photos, Invite) and view toggles (Masonry/Column) float hard-right on their own line with a big empty left gutter — looks unintentional | `HubToolbar .right { margin-left: auto }` + `flex-wrap: wrap`; on a narrow row the right slot wraps to its own line but stays right-pinned |
| 2 | Questions/Ask, Album, Family sub-navs | Segmented sub-nav sits narrow/left instead of spanning; the 3-segment Questions control (To answer / Ask a question / Your asks) nearly clips the right edge | SegmentedControl not full-width at `sm`; intrinsic width overflows at 3 segments |
| 3 | Ask ("For") | Name field is ~half-width instead of full-width | fixed/`max-width` field not unwound at phone width |
| 4 | Album grid | Not judged — seed had no photos (`/api/dev/seed-photos` no-op in hermetic mode) | need real photos to verify 2-col target |
| 5 | Tree | Canvas extends past viewport (expected — pans); modals unverified in static capture | camera wider than viewport is by-design |
| 6 | All modals (album viewer/uploader/destination, tree add-relative/person-details, kebab) | Inline-styled `position:fixed; inset:0` overlay + `width:100%; maxWidth:440/480` surface with **no `max-height` and no `overflow`** → a tall modal pushes off-screen with no scroll; surface touches screen edges; no safe-area inset | modals are inline-styled, NOT CSS modules — so the shared fix is a wrapper/helper, not a class |

## Consequence for the plan

This is a **targeted CSS pass, not a 6-cluster rebuild.** The high-leverage work:

- **Shared:** `HubToolbar` collapse (fixes #1 across Stories/Album/Family at once); SegmentedControl
  full-width at `sm` (#2); a shared **mobile-dialog wrapper/helper** adding `max-height: ~90dvh`,
  `overflow-y: auto`, edge inset, and `env(safe-area-inset-*)` — adopted by the ~8 inline-styled
  modals (#6).
- **Per-surface (small):** full-width form fields where constrained (#3); album 2-col grid verified
  with real photos (#4); tree modals adopt the shared dialog wrapper (#6); spot-check tree controls
  reachable (#5).

The original 6 per-surface builder+reviewer clusters collapse to roughly: one shared-primitives task
(toolbar + segmented + dialog wrapper) and one thin per-surface adoption/verify sweep.
