# Hi-Fi Design Pass — Design Spec

**Date:** 2026-06-27
**Status:** Awaiting review
**Scope:** Bring all `@chronicle/web` components and screens to high fidelity with the **updated** Kindred design system. **Onboarding flow is explicitly out of scope** (deferred to a separate effort).

---

## 1. Problem

The app's UI was ported from an **older snapshot** of the Kindred design system. The design system has since been updated and reorganized, and the live screens no longer match it. Two layers drifted:

1. **Tokens.** The app uses a flat `--kin-*` token set with stale values. The updated system uses a **semantic token layer** (`--accent`, `--surface-*`, `--text-*`, `--shadow-*`) over a primitive palette, a **rem-based** type scale, and **DM Mono** for metadata.
2. **Screens.** The updated showcase (`Family Chronicle.dc.html`) defines richer product screens — a **tabbed family hub** with an account menu and notification badges, updated story cards, listen bar, and larger voice controls — that the app does not yet implement.

## 2. Source of truth (read these; trust in this order)

All under `docs/design-system/intergenerational-story-design-system/project/`:

1. **`_ds/kindred-design-system-495fbf7d-.../tokens/*.css`** — the canonical, current tokens (colors, typography, spacing, motion, fonts). **This is the token source of truth.**
2. **`Family Chronicle.dc.html`** — the canonical, current **screen** designs and the authoritative way components are *used* (props, sizes, copy). Screen line anchors:
   - Narrator conversation ("Hello, Sal.") — line ~44 (and alt at ~114)
   - Narrator approval ("Ready to share this one?") — line ~156
   - Family hub (tabbed shell, 1180×820) — line ~225; tabs: Stories ~274, Questions for you ~395, Ask a question ~421, Your asks ~452, Invite ~475
   - Sample data ~532; component-prop logic (`renderVals()`) ~660–810
3. **`_ds/.../_ds_bundle.js`** — compiled component internals. Reference only if the showcase's rendered styling is ambiguous.

> **Do NOT trust** `kindred-design-system/components/core/*.jsx` or `.d.ts` — they are a **stale export** (they show the old `state`-based voice-button API; the real API is `listening`/`size`). Derive component contracts from showcase usage + the bundle.

## 3. Decisions (already made)

- **D1 — Migrate to semantic tokens.** Port the `_ds` token files into the app as the new `tokens.css`. Update all components and screens to consume semantic names. Keep **thin `--kin-* → semantic` aliases temporarily** so nothing breaks mid-migration; remove aliases once all consumers are converted.
- **D2 — Rebuild the hub as one tabbed shell.** Consolidate `/hub`, `/hub/ask`, `/hub/asks`, `/hub/invite` into a single hub surface with tabs (Stories / Questions for you / Ask a question / Your asks / Invite), an **account avatar menu** (profile / settings / manage family / log out), and **tab notification badges**, matching the showcase.

## 4. Token migration (foundation)

Replace `apps/web/app/_kindred/tokens.css` with a port of the `_ds` tokens:

- **Colors** — primitive palette (`--paper-100/200/300`, `--ink-900/700/500`, `--terracotta-*`, `--sage-*`, `--line-200/300`) + semantic aliases (`--surface-page/card/sunken`, `--text-body/muted/meta`, `--accent`/`-strong`/`-soft`/`-on`, `--support`/`-soft`, `--border`/`-strong`, `--focus-ring`, `--shadow-sm/card/lift`). Three themes: `:root`/`[data-theme="heirloom"]`, `archive`, `hearth`.
- **Typography** — rem scale: `--text-label` .875rem, `--text-ui-sm` 1.125rem (UI floor 18px), `--text-ui` 1.25rem, `--text-ui-lg` 1.5rem, `--text-story` 1.375rem (story floor 22px), `--text-story-lg` 1.75rem, `--text-prompt` 2rem, `--text-display` 2.75rem, `--text-display-lg` 3.5rem. Leading + tracking + weight tokens. Fonts: `--font-story` (Newsreader), `--font-ui` (Public Sans), `--font-mono` (DM Mono).
- **Spacing/radius/touch** — `--space-1..9` (rem), `--radius-sm` 8 / `-md` 12 / `-lg` 18 / `-xl` 24 / `-pill`, `--touch-min` 44 / `-default` 64 / `-voice` 96, `--border-width` 1.5px.
- **Motion** — port `motion.css` (the listening pulse + .15s fades).
- **Compatibility shim** — a block mapping the old `--kin-*` names to the new semantic vars, marked for removal. Wire the existing pulse keyframe name(s) used by components.

**Fonts:** add **DM Mono** to `app/layout.tsx` via `next/font/google` and expose it as `--font-mono`; keep Newsreader + Public Sans. Update the token font vars to read the `next/font` variables (no runtime Google CDN fetch).

## 5. Components (`apps/web/app/_kindred/*.tsx`)

Reconcile each to the showcase contract. Keep the app's genuinely-needed functional enhancements (real audio playback, `disabled`, `saving`, `href`, form `type`) but align prop **names** and **visuals** to the design.

- **KindredButton** — `variant` primary/secondary/ghost, `size` small(44)/default(64)/large(76). Keep `disabled`, `type`, `fullWidth`, children. Verify height, radius, accent fills against showcase.
- **KindredVoiceButton** — adopt the showcase API: `listening: boolean`, `label`, `onClick`, `size` (px; showcase uses 140/160/220 for the narrator screen, 150 approval). Keep the app's `saving`/`disabled` as additive states. Pulse ring + waveform per `motion.css`.
- **KindredListenBar** — adopt `playing` + `onToggle` (showcase) while keeping the app's real `<audio>` playback + `src`. Title/duration/waveform; waveform recolors to accent while playing.
- **KindredStoryCard** — support showcase fields: `title`, `year`, `place`, `duration`, `excerpt`, optional `imageSrc` (striped placeholder fallback), `pinned`, plus app's `href`/`onClick`. Mono for year·place·duration.
- **KindredPromptCard** — `eyebrow`, `question`, children; restore `{...rest}` passthrough.
- **KindredChip** — `kind` person/place/time (+ app `status`), `label`, `initial`, `avatar`; restore `{...rest}`. Unicode place pin.

General: restore `{...rest}` spreading on all components (a11y/composition); make demo props optional where the app forced them required only if it doesn't conflict with real call sites.

## 6. Screens

Each screen re-implemented to match the showcase, using the components + semantic tokens (minimal ad-hoc inline styling).

- **Narrator conversation** — `app/s/[token]/page.tsx` + `NarratorRecorder.tsx`. Match "Hello, Sal." layout: large serif greeting, prompt card, single loud voice button (size ~220). Preserve token-as-identity data flow and the warm null-token fallback.
- **Narrator approval** — `app/s/[token]/approve/[storyId]/page.tsx` + `ApprovalRecorder.tsx`. Match "Ready to share this one?": listen bar of the recording, audience-tier picker, "Approve aloud" voice button (~150).
- **Family hub (tabbed shell)** — `app/hub/page.tsx` becomes the shell with tabs + account menu + badges. Tab contents:
  - **Stories** — narrator section(s) with updated `KindredStoryCard`s + featured listen bar (from `loadHubFeed`).
  - **Questions for you** — pending asks routed to the viewer.
  - **Ask a question** — the compose form (from `/hub/ask`).
  - **Your asks** — the asker's outbox (from `/hub/asks`).
  - **Invite** — the invite-a-narrator form + result (from `/hub/invite`).
  - **Account menu** — profile / settings / manage family / log out (wire log out + switch-user; profile/settings/manage-family may be stubs/links if no backend, clearly marked).
  - Routing: keep deep-linkable URLs (e.g. `/hub?tab=asks` or nested routes rendered within the shell) so existing links/redirects (server actions that `redirect("/hub/invite/result")`) still resolve. Preserve all existing server actions and data loaders; this is a **presentation** restructure, not a data-layer change.
- **Story detail** — `app/hub/stories/[id]/page.tsx`. Align to showcase story-detail treatment (serif prose, listen bar, chips).
- **Supporting** — `app/page.tsx` (home), `app/layout.tsx` (fonts/theme attr), `app/dev/sign-in`, `app/dev/seed`, `globals.css`: bring type/color/spacing to the new tokens.

## 7. Theming

`:root` = Heirloom. Set `data-theme` on `<html>` (default heirloom). Components read tokens only, so `archive`/`hearth` re-skin automatically. No per-component color hardcoding.

## 8. Non-goals / out of scope

- The **onboarding flow** (welcome / birthday / two-doors / interview) and its backend (full DOB, join-invite, provisioning) — separate effort.
- New backend/data changes. The data layer, auth, capture, and `@chronicle/core` front door are **unchanged**; this is a UI/presentation pass.
- Updating the design-system artifact files themselves (the `.dc.html`/`.jsx` source) — we consume them, not edit them.

## 9. Verification

- `pnpm -r typecheck` + `pnpm -r build` clean.
- `pnpm --filter @chronicle/web test` and the architecture tests still pass (no new `@chronicle/db/content` / `.query.stories` access — UI pass must not touch the audited surface).
- Manual: run `pnpm --filter @chronicle/web dev`, walk each screen (narrator, approval, hub tabs, story detail) against the showcase; check all three themes.
- Side-by-side fidelity check of each rebuilt screen vs its `Family Chronicle.dc.html` counterpart.

## 10. Risks

- **Hub restructure** is the riskiest piece — it touches routing and server actions wired to redirects. Mitigate by preserving URLs/actions and only changing presentation; do hub last, after tokens + components are stable.
- **Stale `.jsx`/`.d.ts`** could mislead implementation — spec mandates deriving contracts from the showcase usage instead.
- **Token alias removal** could leave dangling `--kin-*` refs — grep to zero before deleting the shim.
