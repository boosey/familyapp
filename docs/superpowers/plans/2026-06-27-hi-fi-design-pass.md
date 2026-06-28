# Hi-Fi Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all `@chronicle/web` components and screens to high fidelity with the updated Kindred design system (semantic tokens + richer screens), with the family hub rebuilt as a single tabbed shell.

**Architecture:** Migrate the app from the stale flat `--kin-*` token set to the design system's semantic token layer (`--accent`, `--surface-*`, `--text-*`, rem type scale, DM Mono). A temporary `--kin-* → semantic` compatibility shim keeps existing code building while components and screens are converted one at a time; the shim is deleted last. This is a **presentation-only** pass — no changes to the data layer, auth, capture, or the `@chronicle/core` front door.

**Tech Stack:** Next.js 15 (App Router, React 19, server components), TypeScript (strict, ESM), CSS custom properties, `next/font/google`, Vitest.

**Source of truth (read before each task):**
- Tokens: `docs/design-system/intergenerational-story-design-system/project/_ds/kindred-design-system-495fbf7d-96e7-492a-aafc-cbbbd5477f79/tokens/*.css`
- Screens + component usage: `docs/design-system/intergenerational-story-design-system/project/Family Chronicle.dc.html` (anchors in the spec §2)
- **Do NOT trust** `kindred-design-system/components/core/*.jsx` / `.d.ts` — stale export. Derive component contracts from showcase usage.
- Full spec: `docs/superpowers/specs/2026-06-27-hi-fi-design-pass-design.md`

**Testing note (UI work):** There are no pixel unit tests. "Verify" for each task means: `pnpm --filter @chronicle/web typecheck` is clean, the dev server compiles the touched route with no console error, and the existing suites stay green (`pnpm --filter @chronicle/web test`, plus the `@chronicle/core` and `@chronicle/pipeline` architecture tests). A manual fidelity check against the showcase is part of the final task.

**Commits:** This repo's owner commits manually. Each task ends with a *suggested* commit the implementer runs only if the owner has authorized committing; otherwise leave changes staged for review.

---

## File map

**Created:**
- `apps/web/app/_kindred/KindredAccountMenu.tsx` — account avatar + dropdown (client)
- `apps/web/app/hub/HubTabs.tsx` — tab bar with badges + active-tab routing (client)
- `apps/web/app/hub/tabs/StoriesTab.tsx`, `QuestionsTab.tsx`, `AskTab.tsx`, `AsksTab.tsx`, `InviteTab.tsx` — tab content (server where possible)

**Modified:**
- `apps/web/app/_kindred/tokens.css` — full replacement (semantic tokens + shim)
- `apps/web/app/layout.tsx` — add DM Mono; set `data-theme`
- `apps/web/app/globals.css` — convert base + utilities to semantic tokens
- `apps/web/app/_kindred/{KindredButton,KindredVoiceButton,KindredListenBar,KindredStoryCard,KindredPromptCard,KindredChip}.tsx`
- `apps/web/app/_kindred/index.ts` — export new components
- `apps/web/app/s/[token]/page.tsx` + `ElderRecorder.tsx`
- `apps/web/app/s/[token]/approve/[storyId]/page.tsx` + `ApprovalRecorder.tsx`
- `apps/web/app/hub/page.tsx` — becomes the tabbed shell
- `apps/web/app/hub/ask/page.tsx`, `hub/asks/page.tsx`, `hub/invite/page.tsx`, `hub/invite/result/page.tsx` — thin redirects or re-exports into the shell
- `apps/web/app/hub/stories/[id]/page.tsx`
- `apps/web/app/page.tsx`, `app/dev/sign-in/page.tsx`, `app/dev/seed/page.tsx`

---

## Task 1: Token foundation (semantic tokens + DM Mono + compat shim)

**Files:**
- Modify (full replace): `apps/web/app/_kindred/tokens.css`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Replace `tokens.css` with the semantic token system + shim.**

Write `apps/web/app/_kindred/tokens.css` to exactly this content:

```css
/* Kindred Design System tokens — ported from the canonical _ds token set
 * (docs/design-system/.../_ds/.../tokens/*.css). Semantic layer over a primitive
 * palette. Fonts are self-hosted by next/font in app/layout.tsx and injected as
 * --font-newsreader / --font-public-sans / --font-dm-mono on <html>.
 *
 * NOTE: the `--kin-*` block at the bottom is a TEMPORARY compatibility shim mapping
 * the old flat names to the new semantic vars. Removed in the final task once all
 * consumers are converted. Do not add new --kin-* references. */

:root,
[data-theme="heirloom"] {
  --paper-100: #FBF6EE;
  --paper-200: #F4ECE0;
  --paper-300: #EAE0D0;
  --ink-900: #2E2620;
  --ink-700: #4A3F35;
  --ink-500: #6B5F54;
  --terracotta-600: #BD5B3D;
  --terracotta-700: #A24A2F;
  --terracotta-100: #F3DACE;
  --sage-600: #7C8B6F;
  --sage-100: #DEE4D6;
  --line-200: #E2D6C5;
  --line-300: #D6C7B2;

  --surface-page: var(--paper-200);
  --surface-card: var(--paper-100);
  --surface-sunken: var(--paper-300);
  --text-body: var(--ink-900);
  --text-muted: var(--ink-500);
  --text-meta: var(--ink-700);
  --accent: var(--terracotta-600);
  --accent-strong: var(--terracotta-700);
  --accent-soft: var(--terracotta-100);
  --accent-on: #FFFFFF;
  --support: var(--sage-600);
  --support-soft: var(--sage-100);
  --border: var(--line-200);
  --border-strong: var(--line-300);
  --focus-ring: var(--terracotta-600);

  --shadow-sm: 0 1px 2px rgba(70, 50, 30, 0.08);
  --shadow-card: 0 2px 10px rgba(70, 50, 30, 0.10);
  --shadow-lift: 0 8px 28px rgba(70, 50, 30, 0.16);
}

[data-theme="archive"] {
  --paper-100: #F7F8F9; --paper-200: #ECEEF0; --paper-300: #DFE3E6;
  --ink-900: #232A2E; --ink-700: #3C474C; --ink-500: #5C6B72;
  --line-200: #D4DADD; --line-300: #C2CACE;
  --surface-page: var(--paper-200); --surface-card: var(--paper-100); --surface-sunken: var(--paper-300);
  --text-body: var(--ink-900); --text-muted: var(--ink-500); --text-meta: var(--ink-700);
  --accent: #45707C; --accent-strong: #355864; --accent-soft: #D2E0E4; --accent-on: #FFFFFF;
  --support: #8A8270; --support-soft: #E0DED2; --border: var(--line-200); --border-strong: var(--line-300);
  --focus-ring: #45707C;
  --shadow-sm: 0 1px 2px rgba(30, 45, 55, 0.08);
  --shadow-card: 0 2px 10px rgba(30, 45, 55, 0.10);
  --shadow-lift: 0 8px 28px rgba(30, 45, 55, 0.16);
}

[data-theme="hearth"] {
  --paper-100: #FBEFEA; --paper-200: #F3E4DD; --paper-300: #E9D3C9;
  --ink-900: #34241F; --ink-700: #543A32; --ink-500: #7A5F56;
  --line-200: #E8D2C8; --line-300: #DCC0B3;
  --surface-page: var(--paper-200); --surface-card: var(--paper-100); --surface-sunken: var(--paper-300);
  --text-body: var(--ink-900); --text-muted: var(--ink-500); --text-meta: var(--ink-700);
  --accent: #B5524C; --accent-strong: #97403B; --accent-soft: #F1D2CC; --accent-on: #FFFFFF;
  --support: #A8745C; --support-soft: #EFD8C9; --border: var(--line-200); --border-strong: var(--line-300);
  --focus-ring: #B5524C;
  --shadow-sm: 0 1px 2px rgba(80, 40, 30, 0.09);
  --shadow-card: 0 2px 10px rgba(80, 40, 30, 0.12);
  --shadow-lift: 0 8px 28px rgba(80, 40, 30, 0.18);
}

:root {
  /* fonts — next/font injects the variables; these add the fallbacks */
  --font-story: var(--font-newsreader, 'Newsreader'), Georgia, 'Times New Roman', serif;
  --font-ui: var(--font-public-sans, 'Public Sans'), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-dm-mono, 'DM Mono'), ui-monospace, 'SF Mono', Menlo, monospace;

  --text-label: 0.875rem;
  --text-ui-sm: 1.125rem;
  --text-ui: 1.25rem;
  --text-ui-lg: 1.5rem;
  --text-story: 1.375rem;
  --text-story-lg: 1.75rem;
  --text-prompt: 2rem;
  --text-display: 2.75rem;
  --text-display-lg: 3.5rem;

  --leading-tight: 1.15;
  --leading-snug: 1.3;
  --leading-body: 1.55;
  --leading-loose: 1.7;
  --tracking-mono: 0.04em;
  --tracking-tight: -0.01em;
  --weight-regular: 400; --weight-medium: 500; --weight-semibold: 600; --weight-bold: 700;

  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
  --space-5: 1.5rem; --space-6: 2rem; --space-7: 2.5rem; --space-8: 3rem; --space-9: 4rem;

  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 18px; --radius-xl: 24px; --radius-pill: 999px;
  --touch-min: 44px; --touch-default: 64px; --touch-voice: 96px;
  --border-width: 1.5px;

  --ease-quiet: cubic-bezier(0.33, 0, 0.2, 1);
  --dur-fade: 0.15s; --dur-settle: 0.28s; --dur-pulse: 2.4s;
}

@keyframes kindred-listening {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
  50%      { box-shadow: 0 0 0 14px transparent; }
}
/* Alias kept for any component still referencing the old pulse name; remove with the shim. */
@keyframes kin-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
  50%      { box-shadow: 0 0 0 16px transparent; }
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fade: 0s; --dur-settle: 0s; }
}

/* ---------------------------------------------------------------------------
 * TEMPORARY compatibility shim: old --kin-* names → new semantic vars.
 * Delete in the final task after grep confirms zero --kin-* references remain.
 * ------------------------------------------------------------------------- */
:root {
  --kin-bg: var(--surface-page);
  --kin-paper: var(--surface-card);
  --kin-surface: var(--surface-card);
  --kin-ink: var(--text-body);
  --kin-body: var(--text-body);
  --kin-ink-2: var(--text-meta);
  --kin-muted: var(--text-muted);
  --kin-line: var(--border);
  --kin-line-2: var(--border-strong);
  --kin-accent: var(--accent);
  --kin-accent-press: var(--accent-strong);
  --kin-tint: var(--accent-soft);
  --kin-tint-border: var(--border);
  --kin-sage: var(--support);
  --kin-gold: var(--support);
  --kin-chip-bg: var(--surface-sunken);
  --kin-chip-border: var(--border);
  --kin-field: var(--border-strong);
  --kin-ph-a: var(--surface-sunken);
  --kin-ph-b: var(--paper-200);
  --kin-ph-text: var(--text-muted);
  --kin-bezel: var(--ink-900);
  --kin-on-accent: var(--accent-on);
  --kin-ring: var(--accent-soft);
  --kin-ring-0: transparent;

  --kin-font-serif: var(--font-story);
  --kin-font-sans: var(--font-ui);
  --kin-font-mono: var(--font-mono);

  --kin-text-display: var(--text-display-lg);
  --kin-text-title: var(--text-display);
  --kin-text-headline: var(--text-story-lg);
  --kin-text-story: var(--text-story);
  --kin-text-h2: var(--text-story-lg);
  --kin-text-h3: var(--text-ui);
  --kin-text-body: var(--text-ui-sm);
  --kin-text-sm: var(--text-label);
  --kin-text-label: var(--text-label);

  --kin-tracking-label: .08em;
  --kin-leading-story: var(--leading-loose);
  --kin-leading-ui: var(--leading-body);

  --kin-space-1: var(--space-1);
  --kin-space-2: var(--space-2);
  --kin-space-3: var(--space-4);
  --kin-space-4: var(--space-5);
  --kin-space-5: var(--space-6);
  --kin-space-6: var(--space-8);
  --kin-space-7: var(--space-9);

  --kin-radius-sm: var(--radius-md);
  --kin-radius-md: var(--radius-lg);
  --kin-radius-lg: var(--radius-lg);
  --kin-radius-xl: var(--radius-xl);
  --kin-radius-pill: var(--radius-pill);

  --kin-shadow-sm: var(--shadow-sm);
  --kin-shadow-md: var(--shadow-card);
  --kin-shadow-lg: var(--shadow-lift);

  --kin-touch-min: var(--touch-min);
  --kin-touch-default: var(--touch-default);
  --kin-touch-primary: var(--touch-voice);
}
```

- [ ] **Step 2: Add DM Mono and set the theme attribute in `layout.tsx`.**

In `apps/web/app/layout.tsx`: import `DM_Mono` from `next/font/google`, instantiate it, and add its variable to `<html>`. Also add `data-theme="heirloom"`.

```tsx
import { Newsreader, Public_Sans, DM_Mono } from "next/font/google";
// ...
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-dm-mono",
});
// ...
return (
  <html
    lang="en"
    data-theme="heirloom"
    className={`${newsreader.variable} ${publicSans.variable} ${dmMono.variable}`}
  >
    {inner}
  </html>
);
```

- [ ] **Step 3: Verify typecheck + dev compile.**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: no errors.
Run: `pnpm --filter @chronicle/web dev` and load `/` — page renders with the new warm palette (accent terracotta `#BD5B3D`, page `#F4ECE0`), no console errors. Stop the server.

- [ ] **Step 4 (suggested commit):**

```bash
git add apps/web/app/_kindred/tokens.css apps/web/app/layout.tsx
git commit -m "feat(web): migrate to semantic design tokens + DM Mono (with --kin-* shim)"
```

---

## Task 2: Convert `globals.css` base + utilities to semantic tokens

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Rewrite each `--kin-*` reference in `globals.css` to its semantic equivalent.**

Apply these substitutions throughout the file (the shim still backs anything missed):
`--kin-bg`→`--surface-page`, `--kin-paper`→`--surface-card`, `--kin-surface`→`--surface-card`, `--kin-body`/`--kin-ink`→`--text-body`, `--kin-ink-2`→`--text-meta`, `--kin-muted`→`--text-muted`, `--kin-line`→`--border`, `--kin-line-2`→`--border-strong`, `--kin-accent`→`--accent`, `--kin-accent-press`→`--accent-strong`, `--kin-tint`→`--accent-soft`, `--kin-field`→`--border-strong`, `--kin-chip-bg`→`--surface-sunken`, `--kin-chip-border`→`--border`, `--kin-ring`→`--accent-soft`, `--kin-on-accent`→`--accent-on`.
Fonts: `--kin-font-sans`→`--font-ui`, `--kin-font-serif`→`--font-story`, `--kin-font-mono`→`--font-mono`.
Type: `--kin-text-body`→`--text-ui-sm`, `--kin-text-sm`→`--text-label`, `--kin-text-label`→`--text-label`, `--kin-text-title`→`--text-display`, `--kin-text-h2`→`--text-story-lg`, `--kin-text-h3`→`--text-ui`, `--kin-text-story`→`--text-story`.
Leading: `--kin-leading-ui`→`--leading-body`, `--kin-leading-story`→`--leading-loose`.
Spacing: `--kin-space-2`→`--space-2`, `--kin-space-3`→`--space-4`, `--kin-space-5`→`--space-6`.
Radius: `--kin-radius-sm`→`--radius-md`, `--kin-radius-xl`→`--radius-xl`, `--kin-radius-pill`→`--radius-pill`.
Shadow: `--kin-shadow-md`→`--shadow-card`.
Heading `font-weight: 500` stays. Keep all class names (`kin-page`, `kin-frame`, `kin-fullbleed`, `kin-field`, `kin-muted`, `kin-ink-2`, `kin-form-label`, `kin-label`, `kin-eyebrow`, `kin-serif`, `kin-stack*`, `kin-row`, `kin-divider`, `kin-dev-banner`) — screens reference them; renaming is out of scope.

- [ ] **Step 2: Verify.**

Run: `pnpm --filter @chronicle/web typecheck` → clean.
Load `/`, `/hub` (anonymous), `/dev/sign-in` in dev → render correctly, no console errors. Stop server.

- [ ] **Step 3 (suggested commit):**

```bash
git add apps/web/app/globals.css
git commit -m "refactor(web): point globals.css at semantic tokens"
```

---

## Task 3: KindredButton

**Files:**
- Modify: `apps/web/app/_kindred/KindredButton.tsx`

Reference: showcase buttons (e.g. primary CTA on Elder screens; tab buttons line ~233; "Save" / form buttons in hub tabs). Contract:

```ts
interface KindredButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "default" | "large"; // 44 / 64 / 76 px min-height
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  children?: React.ReactNode;
}
```

- [ ] **Step 1:** Update the component: add `size` (44/64/76 `min-height`, font 18/20/24px), keep `variant`, `disabled`, `type`, `children`/`label`, `fullWidth`. Spread `...rest`. Replace all colors/fonts/radii with semantic tokens: primary `background:var(--accent); color:var(--accent-on)`; secondary `background:transparent; border:var(--border-width) solid var(--border-strong); color:var(--text-body)`; ghost `background:transparent; color:var(--accent)`. Radius `var(--radius-pill)` for pill CTAs (match showcase). Hover → `--accent-strong`. Disabled `opacity:.55; cursor:not-allowed`. Focus ring `0 0 0 4px var(--accent-soft)`.
- [ ] **Step 2:** Verify call sites still compile (hub anonymous sign-in, invite form submit). Run `pnpm --filter @chronicle/web typecheck` → clean.
- [ ] **Step 3 (suggested commit):** `git commit -am "feat(web): KindredButton semantic tokens + size variants"`

---

## Task 4: KindredVoiceButton

**Files:**
- Modify: `apps/web/app/_kindred/KindredVoiceButton.tsx`
- Modify call sites: `apps/web/app/s/[token]/ElderRecorder.tsx`, `apps/web/app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx`

Showcase contract (from `renderVals()` ~753–774): `{ listening: boolean, label: string, onClick, size: number }`. Sizes used: elder idle 220, elder answer 140/160, approval 150. Idle shows mic glyph + pulse ring (`kindred-listening` animation on a ring using `--accent-soft`); listening shows stop square. Keep the app's additive `saving`/`disabled` (dim ring with `--accent-strong`, block clicks).

```ts
interface KindredVoiceButtonProps {
  listening?: boolean;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  size?: number;     // px diameter; default 96 (--touch-voice)
  onClick?: () => void;
}
```

- [ ] **Step 1:** Rewrite component to this API + semantic tokens + `kindred-listening` keyframe. Map the app's old `state` prop usage out.
- [ ] **Step 2:** Update `ElderRecorder.tsx` and `ApprovalRecorder.tsx` to pass `listening`/`size` instead of `state`. Keep their existing recording/upload state machine; translate internal state → `listening`/`saving` booleans. Preserve all capture logic (token, askId, POST to `/api/capture`).
- [ ] **Step 3:** Verify `pnpm --filter @chronicle/web typecheck` clean; load `/s/<seeded-token>` in dev (seed via `/dev/seed`) → voice button renders large with pulse; clicking toggles to listening. Stop server.
- [ ] **Step 4 (suggested commit):** `git commit -am "feat(web): KindredVoiceButton listening/size API"`

---

## Task 5: KindredListenBar

**Files:**
- Modify: `apps/web/app/_kindred/KindredListenBar.tsx`
- Modify call sites: `apps/web/app/hub/stories/[id]/page.tsx`

Showcase contract (~771, ~808): `{ playing, duration, title, onToggle }` + waveform bars. Keep the app's real `<audio>` playback and `src` (when `src` is present it self-manages `playing`; when only `onToggle`/`playing` are given it's controlled). Waveform recolors `--support`→`--accent` while playing. Play glyph ▶ / pause ⏸.

```ts
interface KindredListenBarProps {
  src?: string;
  title?: string;
  duration?: string;
  playing?: boolean;        // controlled mode
  onToggle?: () => void;    // controlled mode
  bars?: number[];
}
```

- [ ] **Step 1:** Rewrite to support both modes; semantic tokens; `...rest` spread.
- [ ] **Step 2:** Update story-detail call site to current prop names.
- [ ] **Step 3:** Verify typecheck clean; load a seeded story detail → bar plays audio. Stop server.
- [ ] **Step 4 (suggested commit):** `git commit -am "feat(web): KindredListenBar controlled+audio modes"`

---

## Task 6: KindredStoryCard

**Files:**
- Modify: `apps/web/app/_kindred/KindredStoryCard.tsx`
- Modify call sites: `apps/web/app/hub/page.tsx` (will be superseded in Task 11 — keep compiling)

Showcase story cards (sample data ~532–534) carry `title`, `year`, `place`, `duration`, `excerpt`, optional photo. Contract:

```ts
interface KindredStoryCardProps {
  title?: string;
  year?: string;
  place?: string;
  duration?: string;
  excerpt?: string;
  byline?: string;
  era?: string;          // keep for back-compat with current hub
  meta?: string[];       // keep for back-compat
  imageSrc?: string;     // omit → striped placeholder
  pinned?: boolean;
  href?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}
```

- [ ] **Step 1:** Rewrite: serif `--font-story` title (`--text-story-lg`), mono `--font-mono` row for `year · place · duration`, body `excerpt`, optional 120×120 photo/striped placeholder, `pinned` affordance, `<a>` when `href`. Semantic tokens; `...rest`. Render gracefully whether given the new fields or the legacy `era`/`meta`.
- [ ] **Step 2:** Verify typecheck clean; current `/hub` (with a seeded shared story) still renders cards. Stop server.
- [ ] **Step 3 (suggested commit):** `git commit -am "feat(web): KindredStoryCard year/place/excerpt + photo"`

---

## Task 7: KindredPromptCard + KindredChip

**Files:**
- Modify: `apps/web/app/_kindred/KindredPromptCard.tsx`, `apps/web/app/_kindred/KindredChip.tsx`

- [ ] **Step 1:** PromptCard — `eyebrow?`, `question?`, `children?`, `...rest`; eyebrow row = accent dot + mono caption; question in `--font-story` `--text-prompt`; semantic tokens.
- [ ] **Step 2:** Chip — `kind` person/place/time/status, `label`, `initial?`, `avatar?` ('sage'→`--support` | 'accent'→`--accent`), `...rest`. Pill, `--surface-sunken` bg, `--border`. Place uses 📍, person uses avatar initial.
- [ ] **Step 3:** Verify typecheck clean (story-detail uses chips). Stop server.
- [ ] **Step 4 (suggested commit):** `git commit -am "feat(web): KindredPromptCard + KindredChip semantic tokens"`

---

## Task 8: Elder conversation screen

**Files:**
- Modify: `apps/web/app/s/[token]/page.tsx`, `apps/web/app/s/[token]/ElderRecorder.tsx`

Reference: showcase Elder screens, lines ~44–155. Target layout: `--surface-page` full-bleed; top a small identity row (avatar initial on `--support`, name + "Conversation · <day, time>"); centered column (max ~720px) with serif greeting "Hello, {spokenName}." at ~52px `--font-story`, a soft sub-line in `--text-ui` `--text-muted`, then the `KindredPromptCard` (asker's question or default); footer with the single loud `KindredVoiceButton` (size 220, label "Tap to speak"/"Listening…"). Keep the warm null-token fallback (restyled to semantic tokens). Preserve all data flow (`resolveElderSession`, `getElderProfile`, `listPendingAsksForElder`, `askId` wiring).

- [ ] **Step 1:** Update `page.tsx` markup/styles to the above using semantic tokens (no `--kin-*`).
- [ ] **Step 2:** Update `ElderRecorder.tsx` voice-button props (size 220) if not already from Task 4; keep capture logic.
- [ ] **Step 3:** Verify typecheck clean; seed via `/dev/seed`, open the elder link → matches showcase greeting/prompt/voice layout. Stop server.
- [ ] **Step 4 (suggested commit):** `git commit -am "feat(web): hi-fi elder conversation screen"`

---

## Task 9: Elder approval screen

**Files:**
- Modify: `apps/web/app/s/[token]/approve/[storyId]/page.tsx`, `ApprovalRecorder.tsx`

Reference: showcase "Ready to share this one?" line ~156; approval props ~771–774 (listen bar `duration:'3:48'`, voice "Approve aloud" size 150; audience TIER list ~662). Target: serif headline "Ready to share this one?" (~46px), the recording in a `KindredListenBar`, the audience-tier picker (private / family / public) as pill options bound to existing tier state, and the "Approve aloud" `KindredVoiceButton` (size 150). Preserve `captureApproval` flow + tier semantics.

- [ ] **Step 1:** Restyle `page.tsx` + `ApprovalRecorder.tsx` to semantic tokens + the above components/props; keep all approval/audience logic.
- [ ] **Step 2:** Verify typecheck clean; exercise approval on a seeded pending story. Stop server.
- [ ] **Step 3 (suggested commit):** `git commit -am "feat(web): hi-fi elder approval screen"`

---

## Task 10: Account menu + hub tab bar (building blocks for the shell)

**Files:**
- Create: `apps/web/app/_kindred/KindredAccountMenu.tsx`
- Create: `apps/web/app/hub/HubTabs.tsx`
- Modify: `apps/web/app/_kindred/index.ts`

Reference: showcase account avatar + dropdown (Family Chronicle.dc.html ~236–250; menu items ~741–744: profile ◔, settings ⚙, manage family ⌂, log out →) and tab bar with badges (~230–235).

- [ ] **Step 1: `KindredAccountMenu.tsx` (client).** Avatar button (48px circle, `--accent` bg, `--accent-on` initials, `--border-strong` ring) toggling a dropdown card (`--surface-card`, `--border`, `--shadow-lift`, radius 14px). Props: `initials: string`, `displayName?: string`, `email?: string`, `items: { key; icon; label; href?; onSelect? }[]`. Close on outside-click/Escape. No backend calls inside; parent supplies item actions.
- [ ] **Step 2: `HubTabs.tsx` (client).** Renders the tab buttons from `tabs: { key; label; badge?: number }[]` and an `active` key; clicking calls `onChange(key)` which the shell maps to `router.push('/hub?tab=<key>')` (shallow). Active tab: `--accent` text + underline/`--accent-soft` fill; badge: small pill `--accent`/`--accent-on`.
- [ ] **Step 3:** Export both from `index.ts`.
- [ ] **Step 4:** Verify `pnpm --filter @chronicle/web typecheck` clean.
- [ ] **Step 5 (suggested commit):** `git commit -am "feat(web): account menu + hub tab bar components"`

---

## Task 11: Hub tabbed shell + Stories/Questions tabs

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (becomes the shell)
- Create: `apps/web/app/hub/tabs/StoriesTab.tsx`, `apps/web/app/hub/tabs/QuestionsTab.tsx`

Reference: Family hub ~225–420. The shell reads `?tab=` (default `stories`), renders header (family title + `HubTabs` + `KindredAccountMenu`), and the active tab. Account menu items: Log out → `/dev/sign-in` (or Clerk sign-out when configured) and "Switch user" → `/dev/sign-in`; profile/settings/manage-family are placeholder links (route to `/hub` for now) clearly commented as stubs. Keep `loadHubFeed` + `getCurrentAuthContext` + anonymous gate.

- [ ] **Step 1:** Rewrite `hub/page.tsx`: `searchParams` → active tab; render shell + `KindredAccountMenu` (initials from `ctx`/profile) + `HubTabs` with badges (Questions badge = pending-asks count). Switch on tab to render `StoriesTab` / `QuestionsTab` / `AskTab` / `AsksTab` / `InviteTab` (latter three added in Task 12).
- [ ] **Step 2:** `StoriesTab.tsx` — move the current per-elder feed rendering here using the updated `KindredStoryCard` (+ a featured `KindredListenBar` per the showcase). Server component; receives `feed` as props.
- [ ] **Step 3:** `QuestionsTab.tsx` — list asks routed to the viewer ("Questions for you", ~395). Reuse the existing asks-for-elder data path; server component.
- [ ] **Step 4:** Verify typecheck clean; `/hub?tab=stories` and `?tab=questions` render with seeded data; account menu opens; tabs switch. Stop server.
- [ ] **Step 5 (suggested commit):** `git commit -am "feat(web): tabbed hub shell with stories + questions tabs"`

---

## Task 12: Ask / Asks / Invite tabs + route redirects

**Files:**
- Create: `apps/web/app/hub/tabs/AskTab.tsx`, `AsksTab.tsx`, `InviteTab.tsx`
- Modify: `apps/web/app/hub/ask/page.tsx`, `hub/asks/page.tsx`, `hub/invite/page.tsx`, `hub/invite/result/page.tsx`

- [ ] **Step 1:** Extract each existing page's UI + server actions into the matching `*Tab.tsx`, restyled to semantic tokens (forms use `kin-field`/`kin-form-label`, buttons use `KindredButton`). **Keep the server actions and their `redirect()` targets intact** — point invite success at `/hub?tab=invite&created=1` (render the once-shown token there) instead of `/hub/invite/result`, OR keep `/hub/invite/result` and have it render inside the shell; pick one and apply consistently.
- [ ] **Step 2:** Convert `hub/ask`, `hub/asks`, `hub/invite` `page.tsx` to redirect to `/hub?tab=ask|asks|invite` (preserve deep links). If invite/result is folded into the tab, redirect it too.
- [ ] **Step 3:** Wire these tabs into the shell switch from Task 11.
- [ ] **Step 4:** Verify typecheck clean; create an invite end-to-end (token shows once), submit an ask, view your asks — all within the shell; old URLs redirect. Stop server.
- [ ] **Step 5 (suggested commit):** `git commit -am "feat(web): fold ask/asks/invite into hub tabs"`

---

## Task 13: Story detail + supporting screens

**Files:**
- Modify: `apps/web/app/hub/stories/[id]/page.tsx`, `apps/web/app/page.tsx`, `apps/web/app/dev/sign-in/page.tsx`, `apps/web/app/dev/seed/page.tsx`

- [ ] **Step 1:** Story detail — align to showcase story treatment: serif prose (`--font-story`, `--text-story`, `--leading-loose`, drop-cap optional), `KindredListenBar` of the recording, `KindredChip`s (person/place/time). Semantic tokens; preserve the `@chronicle/core`-gated read.
- [ ] **Step 2:** Home `page.tsx` — eyebrow + serif hero (`--text-display-lg`) + sub, semantic tokens.
- [ ] **Step 3:** `dev/sign-in` + `dev/seed` — restyle to semantic tokens (keep `kin-dev-banner`); no logic change.
- [ ] **Step 4:** Verify typecheck clean; load each. Stop server.
- [ ] **Step 5 (suggested commit):** `git commit -am "feat(web): hi-fi story detail + home + dev screens"`

---

## Task 14: Remove the compatibility shim

**Files:**
- Modify: `apps/web/app/_kindred/tokens.css`

- [ ] **Step 1:** Grep for remaining references: `rg -- "--kin-" apps/web/app` (or use the Grep tool for `--kin-`). Expected after Tasks 2–13: only class names `kin-*` (e.g. `kin-page`) remain — those are CSS classes, not `--kin-*` custom properties. Convert any lingering `var(--kin-*)` to its semantic equivalent.
- [ ] **Step 2:** Delete the `TEMPORARY compatibility shim` `:root` block and the `kin-pulse` alias keyframe from `tokens.css`.
- [ ] **Step 3:** Verify `pnpm --filter @chronicle/web typecheck` clean and `pnpm --filter @chronicle/web build` succeeds (build fails loudly if an undefined var breaks a layout? — at minimum confirm no missing-var visual regressions by loading every screen). Stop server.
- [ ] **Step 4 (suggested commit):** `git commit -am "chore(web): remove --kin-* token shim after migration"`

---

## Task 15: Full verification + fidelity check

**Files:** none (verification only)

- [ ] **Step 1:** Run `pnpm -r typecheck` → clean.
- [ ] **Step 2:** Run `pnpm -r build` → succeeds.
- [ ] **Step 3:** Run `pnpm --filter @chronicle/web test` → green. Run `pnpm --filter @chronicle/core test` and `pnpm --filter @chronicle/pipeline test` → architecture tests green (confirms the UI pass introduced no `@chronicle/db/content` / `.query.stories` access).
- [ ] **Step 4:** `pnpm --filter @chronicle/web dev`; seed via `/dev/seed`; walk each screen against `Family Chronicle.dc.html`: elder conversation, elder approval, hub (each tab + account menu + badges), story detail. Repeat with `data-theme="archive"` and `"hearth"` (temporarily set on `<html>`) to confirm theming. Note any fidelity gaps and fix.
- [ ] **Step 5:** Update `docs/PROGRESS.md` with a short entry for the hi-fi design pass.
- [ ] **Step 6 (suggested commit):** `git commit -am "docs: log hi-fi design pass in PROGRESS"`

---

## Self-review notes

- **Spec coverage:** §4 tokens → Task 1–2; §5 components → Tasks 3–7, 10; §6 screens → Tasks 8–13; §7 theming → Task 1 + Task 15 Step 4; §9 verification → Task 15; shim removal risk (§10) → Task 14.
- **Ordering safety:** the `--kin-*` shim (Task 1) keeps every untouched file building, so components (3–7) and screens (8–13) convert independently without a big-bang break; shim removed only after grep-to-zero (Task 14).
- **Hub risk (§10):** isolated to Tasks 10–12, done after tokens + components are stable; server actions and deep-link URLs preserved via redirects.
- **Stale `.jsx` trap:** every component task points at showcase usage, not the `.jsx`/`.d.ts`.
