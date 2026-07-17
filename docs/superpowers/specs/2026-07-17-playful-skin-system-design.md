# Playful & Warm redesign + a pluggable skin system — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Live app under redesign:** https://tellmeagain.app (the `@chronicle/web` hub)

---

## 1. Problem

The current web UI is, in the user's words, "big, ugly, and clunky." A live audit of
`tellmeagain.app` (landing + hub feed) confirmed five distinct problems, not one:

1. **Dated / amateur.** Beige cards on a beige page with faint hairline outlines and cream
   pills. It reads like a tinted wireframe. The palette (warm cream + serif + terracotta) is
   the single most common generic-AI-design cliché — flagged verbatim by the `artifact-design`
   skill. The color isn't *wrong*; there is simply **no color system** — one accent doing 100%
   of the work on one flat ground.
2. **Clunky.** Before a single story is visible, the hub stacks four control clusters: **8 flat
   text tabs** (Stories, Album, To answer, Ask a question, Your asks, Family, Invite, Requests)
   → family-filter chips → a Feed/Timeline/Search segmented control → a Masonry/Column toggle.
   Database controls are being handed to people who came to read Grandpa's stories.
3. **Oversized.** A 900px column centered in a ~1568px viewport; two cards then a vast empty
   field. The feed feels barren *even with content in it.*
4. **Forgettable + no imagery.** This is a product about family, faces, and photographs — and
   there is **not one image** on the hub. Generic initial-circles, "Undated" stamped on every
   card. It feels like a CRM for memories.
5. **No soul.** Nothing you would describe to a friend.

## 2. Decision

Two decisions, made during brainstorming:

- **Visual direction: "Playful & Warm."** A lovingly-made-scrapbook feel — warm multi-color
  palette, rounded humanist type, taped/tilted photos, sticker tags, a highlighter underline.
  Chosen by the user after comparing four prototyped directions on the real hub screen
  (Heirloom / Cinematic / Modern / Playful — see the published comparison artifact).
- **Architecture: a "skin system" (bounded), NOT a plugin registry.** One shared component
  tree. A *skin* is a token block plus a small, enumerated set of class-based structural
  overrides. Explicitly rejected: a per-UI component registry (every feature built N times —
  velocity death for a ~120-component app). Explicitly rejected: palette-only theming (can't
  express type/motion/shape/structure differences).

### 2.1 Why this is cheaper than it looks

The codebase already earns most of this:

- **Every component styles via `var(--token)`.** A skin that redefines token *values* re-skins
  the **entire app** — inline-styled components included — with near-zero component edits.
- **`preferences/registry.ts` (ADR-0020)** is a data-driven, no-FOUC preference system where
  `theme` is already a `data-attr` swap. Adding `skin` and `reduce-motion` is a few lines each;
  selection, persistence, and pre-paint (no flash) come free.

The one genuine cost: **there are no CSS files — all styling is inline `style={{…}}`.** Inline
styles are the highest specificity, so `[data-skin] .x {…}` cannot override them. Skin
*structural* signatures therefore require moving flagship-surface styling from inline objects to
classes. This is bounded to the flagship surfaces (§5, Phase 2); everything else is covered by
token-value re-skinning.

## 3. Goals / Non-goals

**Goals**
- Replace the current look with the Playful & Warm design language across the app.
- A `data-skin` axis with **two real skins** shipped: `playful` (new default) and `heirloom`
  (the current look, preserved as a skin) — a working toggle that *proves* pluggability.
- A `reduce-motion` preference (independent of, and additive to, `prefers-reduced-motion`).
- Fix the interaction clunk on the flagship surfaces (control overload, no imagery, no
  hierarchy) as part of the same pass.
- Preserve existing accessibility affordances: font-scale, touch-target minimums, focus states,
  contrast, reduced-motion.

**Non-goals (deferred / out of scope)**
- A per-UI plugin/component registry.
- Building skins beyond `playful` + `heirloom` (the architecture supports more; we build two).
- Reworking the 3 existing palettes (heirloom/archive/hearth) — they fold under the `heirloom`
  skin as palette-variants and are otherwise left alone.
- A new information architecture beyond the flagship de-clutter (no new features).

## 4. Architecture

### 4.1 The skin axis

- **`data-skin`** on `<html>` selects the design language. Values: `playful` (default),
  `heirloom`. Set flash-free by the pre-paint script.
- **`data-theme`** (existing) remains a *palette sub-variant within a skin* — untouched this
  pass; heirloom's 3 palettes keep working.
- **`data-tone`** (new, opt-in per subtree, default `warm`): `solemn` dials whimsy down on heavy
  surfaces (see §4.5).

### 4.2 A skin = tokens + bounded structural overrides

- **(a) Token block — the 90%.** Each skin defines the full **token contract**: color roles,
  type roles, radii, borders, shadows, spacing rhythm (where it differs), motion, and
  chip/tag styling. Authored in one file per skin (`app/_skins/playful.css`,
  `app/_skins/heirloom.css`), scoped under `:root[data-skin="…"]`.
- **(b) Structural overrides — the signature 10%.** Class-based CSS scoped
  `:root[data-skin="playful"] .story-card {…}` for the moves tokens can't express (tilt, tape,
  photo-over-title, drop-cap). Only exist for migrated (flagship) surfaces.

### 4.3 Motion as tokens + a real preference

- Motion durations/easings become tokens: `--motion-fade`, `--motion-settle`, `--motion-bounce`,
  `--dur-*`. "Playful bounce" is a token value; suppressing it is a value swap.
- **`reduce-motion` preference** (enum `on`/`off`, default `off`) → `data-motion="reduced"`.
  When reduced (by preference **or** `prefers-reduced-motion`), motion tokens collapse to `0s`
  and structural motion (tilt, tape, bounce, hover-straighten) is disabled via a single guard
  rule. This is the "turn off the movement" toggle the user asked for.

### 4.4 Selection, persistence, pre-paint — extend the registry

Add two entries to `PREFERENCES` in `app/_kindred/preferences/registry.ts`:

```ts
skin:        { key:'skin',         storageKey:SKIN_STORAGE_KEY,   default:DEFAULT_SKIN_ID,
               validate:{kind:'enum', values:SKIN_IDS},      apply:{strategy:'data-attr', attr:'data-skin'} },
reduceMotion:{ key:'reduce-motion', storageKey:MOTION_STORAGE_KEY, default:'off',
               validate:{kind:'enum', values:['on','off']}, apply:{strategy:'data-attr', attr:'data-motion',
                                                                    /* 'on' → 'reduced', 'off' → '' — see note */ } },
```

- The pre-paint drift-guard test (existing) automatically covers the new entries.
- **A skin picker control** (sibling to `KindredThemePicker`) in the account menu, listing the
  registered skins — this is the "play with many ideas" surface. A dev-only expansion can list
  in-progress skins.

Note: `reduce-motion`'s `on`→`data-motion="reduced"` mapping is a small addition to the apply
layer (the current `data-attr` strategy writes the raw value). Either add a `valueMap` to the
`data-attr` strategy or store the value as `reduced`/`` directly. Chosen in the plan.

### 4.5 The gravity guardrail — `data-tone="solemn"`

Playful whimsy must not trivialize heavy moments. A subtree marked `data-tone="solemn"`:
- suppresses tilt, tape, bounce, highlighter (same guard as reduced-motion for structure);
- shifts the palette to the skin's calm variant (muted accents, more paper, less candy);
- keeps warmth (rounded type, soft shadow) so it still feels like the same product.

Applied to: erasure/delete confirmations, approval/consent flows, and story-detail views the
narrator has marked sensitive (hook available; wiring is best-effort this pass).

### 4.6 Styling mechanism for migrated surfaces

- **Plain CSS via CSS Modules** (`*.module.css`) with semantic class names + token vars +
  `:root[data-skin]` overrides. No new runtime dep, RSC-safe (Next 15 App Router / React 19),
  and consistent with the existing token-in-CSS discipline. No CSS-in-JS, no Tailwind.
- Component markup keeps `var(--token)` semantics; values move from inline objects to classes so
  skins can hook them.

## 5. The Playful skin — design language

- **Type (self-hosted via `next/font/google`, matching the Newsreader/Public Sans pattern).**
  The current token set folds *titles and prose* into one serif (`--font-story`); Playful splits
  them, so the skin work first **clarifies the font-role tokens** into four roles, then each skin
  maps faces onto them (heirloom keeps Newsreader/Public Sans; playful uses Baloo 2/Nunito):
  - `--font-display` (headings/titles) → **Baloo 2**
  - `--font-read` (long-form story prose) → **Nunito**
  - `--font-ui` (interface/controls) → **Nunito**
  - `--font-mono` (small uppercase meta rows) → keep **DM Mono**
  - Existing `--font-story` usages are re-pointed to `--font-display` or `--font-read` per usage
    during the Phase-2 migration; the alias stays valid until then so nothing breaks mid-flight.
- **Palette (warm, multi-color; concrete values carried from the approved prototype):**
  - Ground `#FBF1DE`, surface `#FFFDF8`, sunken `#FFF6E6`
  - Ink `#3B2F2A` / strong `#2C221D` / body `#52443C` / muted `#927F6F`
  - Accent (coral) `#EF7A54` / strong `#D85F39` / soft `#FFE3D3`
  - Support accents (sticker tags, rotating): coral `#FFE3D3`/`#C95A33`, sky `#DCEBF7`/`#356A92`,
    leaf `#E6EFD6`/`#5B7A34`, mustard family-pill `#F5DDB0`/`#9A6A1E`
  - Family/relationship semantic colors stay separate from accent.
- **Shape:** radii large (`--radius-lg: 16px`, pill for chips), borders 2px, soft drop shadows
  (`0 6px 0 …` shelf + lift on hover).
- **Signature motifs (all motion/structure-gated by tone + reduce-motion):**
  - Card gentle tilt (odd −0.5°, even +0.5°); hover straightens + lifts.
  - "Tape" strip pseudo-element on photos.
  - Sticker/candy tags (rotating multi-color), pill radius, bold weight.
  - Highlighter underline behind story titles.
  - Photo-forward **featured** card (2-up) + a smaller grid; real family imagery leads.
- **Chrome de-clutter (interaction fix, all skins benefit):** primary nav collapses to
  **Stories · Album · Family · Questions** + a prominent **"＋ Tell a story"** action. The
  Feed/Timeline/Search and Masonry/Column controls leave the primary bar (relocated to a
  secondary "view options" affordance, not front-and-center).

### 5.1 Novel interactions (product-specific — must earn their place)

The redesign should introduce genuinely novel interactions, not just a repaint. But novelty on
a product older relatives use during grief is high-risk: it must tie a scrapbook *metaphor* to a
*real product action*, never be a gimmick, and **always have a plain, fully-functional
fallback.** Every interaction below is gated by `reduce-motion` and `data-tone="solemn"` (no
Polaroid flourish on a story about a death), and is **skin-scoped** — a skin can carry its own
interaction flavor, which is precisely the "play with many ideas" payoff of the skin system.

Curated candidate set (metaphor → real action):

1. **Hold-to-remember** *(capture).* The record CTA is press-and-hold; a warm *breathing*
   waveform reflects the voice instead of a clinical meter. Fallback: tap-to-toggle (motor
   accessibility); reduced-motion → static level bar. Serves the voice-origin core.
2. **Highlight-to-treasure** *(reaction).* Drag across a line in a story to leave a warm
   highlighter swipe with your initial — "this mattered." Upgrades the existing Like into
   something specific to *what* moved you, reusing the skin's highlighter motif *as* an
   interaction. Fallback: tap-to-Like.
3. **Pull-a-thread** *(thematic browse).* Tapping a tag gathers its memories into a taped stack
   that slides together — browsing by theme feels physical. Fallback: normal filtered list;
   reduced-motion → instant filter.
4. **Pass-a-note** *(asking).* Sending a relative a question animates as slipping a handwritten
   card into their book; they receive it "tucked in." Reframes a cold form as an intimate
   gesture. Fallback: standard confirmation + inbox entry.
5. **Develop-on-open** *(unseen reveal).* An unseen memory's photo "develops" like a Polaroid the
   first time it's opened. Ties imagery + the existing "New" badge. Reduced-motion → no animation.

**Commitment level:** validate **1–2 this pass** on surfaces already in Phase 2 —
*hold-to-remember* (capture flow) and *highlight-to-treasure* (story detail). The rest are
prototyped candidates, not commitments; each is a design experiment to test, and any that don't
clearly serve the story get cut. Interactions land as progressive enhancement over the working
fallback — the plain path ships first, the flourish layers on.

## 6. Rollout — two phases, shippable throughout

**Phase 1 — Skin infrastructure + token-only re-skin (fast, ~60% of the visual delta).**
1. Skin token contract + `_skins/playful.css` + `_skins/heirloom.css` (heirloom = today's values).
2. `next/font` wiring for Baloo 2 + Nunito; map font-role tokens per skin.
3. Registry entries for `skin` + `reduceMotion`; pre-paint; skin picker + motion toggle in the
   account menu.
4. Motion tokens + the reduced/solemn structural guard rule.
5. Skin token-contract test.
   → At the end of Phase 1, flipping the skin re-colors/re-types/re-shapes the **entire** app,
     and the motion toggle works app-wide — with no flagship structural work yet.

**Phase 2 — Structural polish on the flagship surfaces (the approved set).**
Migrate inline → CSS Modules and add Playful's signature structure on:
- **Hub feed** — `hub/page.tsx` shell (header/nav de-clutter), `hub/tabs/StoriesTab.tsx`,
  `hub/tabs/StoryBrowse.tsx`.
- **Story card** — `_kindred/KindredStoryCard.tsx` (photo-forward, tilt, tape, sticker tags,
  highlighter, featured variant).
- **Story detail** — `hub/stories/[id]/StoryReadBody.tsx`.
- **Capture / record flow** — `s/[token]/page.tsx`, `hub/tell/*`, `hub/answer/[askId]/*`
  (the emotional core; solemn-tone aware).

Each surface is independent and shippable; unmigrated screens remain correctly Playful-tokened
throughout.

## 7. Guardrails, testing, accessibility

- **Skin token-contract test:** every registered skin defines the full token set (fail CI on a
  half-defined skin that would render broken).
- **Single-source discipline (CLAUDE.md):** Playful values live only in `_skins/playful.css`;
  no hardcoded hex/px re-introduced in components during migration.
- **Reduced-motion:** a test asserts motion tokens collapse and structural motion is disabled
  under `data-motion="reduced"` and `prefers-reduced-motion`.
- **Accessibility (must not regress):**
  - Font-scale preference still works (rem-based type; skins must not hardcode px font sizes).
  - Touch-target minimums (`--touch-*`) preserved.
  - Visible `:focus-visible` state on every interactive element in both skins.
  - Contrast: candy tag colors verified against WCAG AA for their text; solemn palette verified.
- **No-FOUC:** skin + motion applied pre-paint (covered by the existing drift-guard).

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Whimsy trivializes heavy stories | `data-tone="solemn"` dial-down (§4.5) |
| Inline→class migration is large | Phased; token-only Phase 1 delivers most of the look; Phase 2 is per-surface & shippable |
| Multi-color hurts contrast/a11y | AA contrast checks on tags + solemn palette; keep body ink dark |
| Font loading perf/CLS | `next/font` self-host + subset + `display:swap`; two families only |
| Skin abstraction leaks / half-skins | Token-contract test; two real skins force the abstraction to be honest |
| Novel interaction reads as gimmick / excludes users | Every one has a plain fallback (progressive enhancement); gated by reduce-motion + solemn tone; validate 1–2, cut the rest |

## 9. Success criteria

1. A user can switch between `playful` and `heirloom` skins from the account menu; the whole app
   changes, flash-free, and the choice persists.
2. A user can turn motion off; tilt/tape/bounce/transitions stop app-wide.
3. The four flagship surfaces render the Playful signature (photo-forward, tilt, tape, sticker
   tags, highlighter, de-cluttered nav) and look categorically better than the current app.
4. No accessibility regression (font-scale, touch targets, focus, contrast, reduced-motion).
5. At least one novel interaction (hold-to-remember and/or highlight-to-treasure) ships as
   progressive enhancement over a working plain fallback, gated by reduce-motion + solemn tone.
6. All existing suites green; new skin/motion/contract tests added.

## 10. Open questions (resolve during planning)

- Exact `reduce-motion` apply mapping (`valueMap` on `data-attr` vs storing `reduced`/``).
- Whether the skin picker is user-facing immediately or dev-only until Phase 2 lands (leaning:
  user-facing once both skins are token-complete at end of Phase 1).
- Whether `data-tone="solemn"` wiring on sensitive story-detail is in-scope this pass or a
  fast-follow (leaning: hook + confirmations/approvals in-scope; per-story sensitivity flag fast-follow).
- Which of the two committed novel interactions to build first, and whether either needs a core/
  data change (e.g., highlight-to-treasure as a richer reaction may touch the Like/consent model)
  vs. pure client enhancement (hold-to-remember over the existing capture path).
