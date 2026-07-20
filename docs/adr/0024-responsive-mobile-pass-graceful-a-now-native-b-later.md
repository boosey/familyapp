# ADR-0024 — Responsive mobile pass: graceful-A now, native-B later; mobile-first refactor

Status: Accepted (2026-07-19)

Relates to #230 (the /s narrator capture surface was the first mobile pass) and the
`RESPONSIVE_BREAKPOINTS_REM` single-source guard (`app/_kindred/responsive-breakpoints.test.ts`).

## Context

The web UI was built for iPad and desktop web. On a phone (reference: iPhone 16, 393×852 CSS px)
the layouts don't work — everything wraps into ragged multi-line stacks and the app is effectively
unusable. Concretely, only **5 CSS files** in the whole app use `@media` at all; the primary tab bar,
the sub-nav, and the shared two-row toolbar are all `flex-wrap: wrap`; the hub container is a
`max-width: 900px` desktop column; and every modal is a bespoke fixed-width centered desktop dialog.

There is a latent contradiction in the codebase: the repo *declares* itself mobile-first
(`constants.ts` calls the breakpoints "the web app's mobile-first `@media` layers," and the guard
test scans **`min-width` only**), but the actual CSS is **desktop-first** with no mobile
consideration. A mobile pass has to resolve that contradiction one way or the other.

"First-class mobile" is ambiguous between two very different targets: (A) same components, reflow
gracefully so nothing wraps into garbage and touch targets/readability hold; and (B) genuinely
mobile-native UX — bottom tab bar, bottom-sheets, pinch-zoom — which is a design project that doubles
the component surface and fights the repo's intrinsic-layout ethos.

## Decision

**Do approach A now; explicitly park B; and do A the mobile-first way so it does not preclude B.**

- **A (graceful responsive), not B (native).** Same DOM and same navigation; fix reflow, touch
  targets, and overflow. B (bottom-nav, real drag bottom-sheets, pinch-zoom, momentum) is deferred to
  a later ticket. A's choices must not build structure that B would have to tear out.

- **Targets.** Design to **393px** (iPhone 16), hard floor **360px**, spot-check 320px for
  "no horizontal overflow / no overlap" only. Breakpoints stay `sm 40rem (640px)` / `lg 64rem
  (1024px)`; no third breakpoint is added unless a specific surface forces it (flagged, not silent).

- **Mobile-first refactor, not desktop-first overrides.** Base (no-media-query) styles are rewritten
  to target the phone — single column, full-width, stacked — and desktop is layered back on at
  `@media (min-width: sm/lg)`. This honors the stated convention and keeps the guard test (which only
  polices `min-width`) meaningful. The rejected alternative — `@media (max-width: …)` override layers
  — is lower-risk to the *existing* desktop path but betrays the convention, evades the guard, and
  accumulates override-soup that the eventual B pass would have to untangle.

- **Concrete layout rules (A):**
  - Primary tab bar (4 tabs) → **shrink-to-fit** one row; no scroll, no wrap.
  - Sub-nav segmented control, search, action buttons → **full-width, stacked**.
  - Filter chip facets → **horizontal-scroll strip** (chips are browsable, not primary nav).
  - All overlays → **full-width (~100vw inset), `max-height ~90dvh`, internally scrollable**, via a
    **new shared mobile-dialog contract** (modals are bespoke today — the contract is pinned in a
    blocking step before any per-surface fan-out). Safe-area insets on full-screen dialogs.
  - Album grid → **2 columns** at phone width.
  - Tree → frame fills width, controls thumb-reachable, surrounding modals reflow; **camera (pan/zoom)
    math is untouched**. Pinch-zoom is B.

- **Scope.** In: hub shell + all tabs, story detail, compose, answer/ask, invite/onboarding.
  Out: dev surfaces; landing/auth only if already acceptable (verified, not assumed).

- **Verification.** Live-drive Chrome at 393×852 with seed data, screenshot every surface, iterate;
  **extend `responsive-breakpoints.test.ts`** with cheap structural guards; a human does the final
  iPhone 16 / Safari pass (safe-area, 100dvh, momentum). A Playwright visual-regression harness is
  explicitly *not* built in this pass (its own future ticket).

- **Delivery.** One PR off the mobile-responsive worktree. Step 0 pins the shared responsive contract
  (breakpoints confirmed, shared mobile-dialog module, toolbar/segmented collapse, container/padding)
  and is cold-reviewed before fan-out; then per-surface builder + fresh cold-reviewer rounds
  (serial/batched on one branch since they share frozen files); per-surface commits; single merge
  after the full CI-equivalent preflight.

## Consequences

- Touching base styles risks regressing the well-tested desktop/iPad experience; mitigated by
  live-verifying desktop stays intact and by desktop being the layered-on, explicit path.
- The shared mobile-dialog contract is new shared surface every bespoke modal must adopt; adopting it
  is the bulk of the modal work but removes per-modal divergence.
- Parking B is a deliberate bet that graceful reflow is "good enough" for now. Revisit when B is
  scheduled; nothing here should make B more expensive than it would have been on a desktop-first base.
