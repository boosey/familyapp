# Playful Skin System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current look with a "Playful & Warm" design language delivered through a bounded, swappable skin system (two real skins + a reduce-motion toggle), then deeply polish four flagship surfaces.

**Architecture:** A *skin* is a block of CSS custom-property values under `:root[data-skin="…"]` plus (Phase 2 only) a small set of class-based structural overrides. Selection rides the existing ADR-0020 preferences registry (`data-attr` strategy, flash-free pre-paint). Because every component already reads `var(--token)`, redefining token values re-skins the whole app with near-zero component edits (Phase 1). Structural signatures (tilt/tape/sticker/highlighter/photo-forward) require moving flagship-surface styling from inline objects to CSS Modules (Phase 2).

**Tech Stack:** Next.js 15 (App Router) / React 19, TypeScript strict, `next/font/google`, plain CSS + CSS Modules, Vitest (jsdom for DOM tests). Spec: `docs/superpowers/specs/2026-07-17-playful-skin-system-design.md`.

**GIT RULES for every builder/reviewer subagent (non-negotiable):** work only on the current branch in the current worktree; commit there; **never** `git checkout`/`switch`/`reset --hard`/merge/push/rebase, never touch `master`, never create a PR. The main agent owns all branch/PR operations. Commit author must be `boosey <boosey.boudreaux@gmail.com>` (Vercel git-author gate).

---

## File Structure (Phase 1)

**Create**
- `apps/web/app/_kindred/skin-constants.ts` — skin ids, default, storage key (mirrors `theme-constants.ts`).
- `apps/web/app/_kindred/motion-constants.ts` — reduce-motion storage key + values.
- `apps/web/app/_skins/playful.css` — the Playful token block (`:root[data-skin="playful"] { … }`).
- `apps/web/app/_skins/skin-contract.ts` — the required token-name list (single source for the contract test).
- `apps/web/app/_skins/skin-contract.test.ts` — asserts each skin file declares every required token.
- `apps/web/app/_kindred/KindredSkinPicker.tsx` — skin chooser (mirrors `KindredThemePicker`).
- `apps/web/app/_kindred/KindredMotionToggle.tsx` — reduce-motion on/off control.

**Modify**
- `apps/web/app/_kindred/preferences/registry.ts` — add `skin` + `reduceMotion` entries.
- `apps/web/app/_kindred/preferences/registry.test.ts` — parity assertions for the two new entries.
- `apps/web/app/_kindred/preferences/pre-paint.test.ts` — assert `data-skin` + `data-reduce-motion` applied.
- `apps/web/app/_kindred/tokens.css` — add `--font-display` / `--font-read` role tokens to the base `:root` (heirloom = serif).
- `apps/web/app/globals.css` — `@import` playful.css; point `h1,h2,h3` at `--font-display`; add the reduce-motion guard rule.
- `apps/web/app/layout.tsx` — wire Baloo 2 + Nunito; set `data-skin="playful"` default on `<html>`.
- `apps/web/app/hub/settings/SettingsPanel.tsx` — mount the skin picker + motion toggle.
- `apps/web/app/_copy/hub.ts` — copy for the new settings sections.
- `apps/web/app/_kindred/index.ts` — export the new controls if the barrel is used.

---

## Task 1: Skin + reduce-motion constants

**Files:**
- Create: `apps/web/app/_kindred/skin-constants.ts`
- Create: `apps/web/app/_kindred/motion-constants.ts`
- Test: `apps/web/app/_kindred/skin-constants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/_kindred/skin-constants.test.ts
import { describe, expect, it } from "vitest";
import { SKIN_IDS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY } from "./skin-constants";
import { REDUCE_MOTION_VALUES, DEFAULT_REDUCE_MOTION, MOTION_STORAGE_KEY } from "./motion-constants";

describe("skin constants", () => {
  it("ships playful (default) and heirloom", () => {
    expect(SKIN_IDS).toEqual(["playful", "heirloom"]);
    expect(DEFAULT_SKIN_ID).toBe("playful");
    expect(SKIN_IDS).toContain(DEFAULT_SKIN_ID);
  });
  it("has a stable storage key", () => {
    expect(SKIN_STORAGE_KEY).toBe("kin-skin");
  });
});

describe("reduce-motion constants", () => {
  it("is an on/off enum defaulting to off", () => {
    expect(REDUCE_MOTION_VALUES).toEqual(["on", "off"]);
    expect(DEFAULT_REDUCE_MOTION).toBe("off");
    expect(MOTION_STORAGE_KEY).toBe("kin-reduce-motion");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @chronicle/web exec vitest run app/_kindred/skin-constants.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/_kindred/skin-constants.ts
/** Design-language ids — must match `:root[data-skin="…"]` selectors in the `_skins/*.css` files. */
export const SKIN_IDS = ["playful", "heirloom"] as const;
export type SkinId = (typeof SKIN_IDS)[number];
/** Playful is the new default look; heirloom preserves the pre-redesign design language. */
export const DEFAULT_SKIN_ID: SkinId = "playful";
export const SKIN_STORAGE_KEY = "kin-skin";
```

```ts
// apps/web/app/_kindred/motion-constants.ts
/** Reduce-motion preference. `on` writes `data-reduce-motion="on"` on <html>; the CSS guard keys off it. */
export const REDUCE_MOTION_VALUES = ["on", "off"] as const;
export type ReduceMotionValue = (typeof REDUCE_MOTION_VALUES)[number];
export const DEFAULT_REDUCE_MOTION: ReduceMotionValue = "off";
export const MOTION_STORAGE_KEY = "kin-reduce-motion";
```

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `feat(skins): skin + reduce-motion constants`.

---

## Task 2: Register `skin` + `reduceMotion` preferences

**Files:**
- Modify: `apps/web/app/_kindred/preferences/registry.ts`
- Modify: `apps/web/app/_kindred/preferences/registry.test.ts`
- Modify: `apps/web/app/_kindred/preferences/pre-paint.test.ts`

- [ ] **Step 1: Write failing tests** — append to `registry.test.ts`:

```ts
import { SKIN_IDS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY } from "@/app/_kindred/skin-constants";
import { REDUCE_MOTION_VALUES, DEFAULT_REDUCE_MOTION, MOTION_STORAGE_KEY } from "@/app/_kindred/motion-constants";

describe("PREFERENCES registry — skin + reduce-motion", () => {
  it("skin is an enum data-attr writing data-skin, defaulting to playful", () => {
    expect(PREFERENCES.skin.default).toBe(DEFAULT_SKIN_ID);
    expect(PREFERENCES.skin.storageKey).toBe(SKIN_STORAGE_KEY);
    expect(PREFERENCES.skin.validate).toMatchObject({ kind: "enum", values: SKIN_IDS });
    expect(PREFERENCES.skin.apply).toEqual({ strategy: "data-attr", attr: "data-skin" });
  });
  it("reduceMotion is an on/off enum writing data-reduce-motion", () => {
    expect(PREFERENCES.reduceMotion.default).toBe(DEFAULT_REDUCE_MOTION);
    expect(PREFERENCES.reduceMotion.storageKey).toBe(MOTION_STORAGE_KEY);
    expect(PREFERENCES.reduceMotion.validate).toMatchObject({ kind: "enum", values: REDUCE_MOTION_VALUES });
    expect(PREFERENCES.reduceMotion.apply).toEqual({ strategy: "data-attr", attr: "data-reduce-motion" });
  });
});
```

Append to `pre-paint.test.ts` (inside the first describe or a new one):

```ts
it("applies stored skin and reduce-motion to <html>", () => {
  localStorage.setItem(PREFERENCES.skin.storageKey, "heirloom");
  localStorage.setItem(PREFERENCES.reduceMotion.storageKey, "on");
  runPrePaint();
  expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
  expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("on");
});
it("defaults skin=playful, reduce-motion=off when unset", () => {
  runPrePaint();
  expect(document.documentElement.getAttribute("data-skin")).toBe("playful");
  expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("off");
});
```
Also add `document.documentElement.removeAttribute("data-skin"); document.documentElement.removeAttribute("data-reduce-motion");` to the `beforeEach` reset.

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @chronicle/web exec vitest run app/_kindred/preferences` → FAIL (`PREFERENCES.skin` undefined).

- [ ] **Step 3: Implement** — in `registry.ts` add imports and two entries to `PREFERENCES` (after `theme`):

```ts
import { SKIN_IDS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY } from "@/app/_kindred/skin-constants";
import { REDUCE_MOTION_VALUES, DEFAULT_REDUCE_MOTION, MOTION_STORAGE_KEY } from "@/app/_kindred/motion-constants";
// …
  skin: {
    key: "skin",
    storageKey: SKIN_STORAGE_KEY,
    default: DEFAULT_SKIN_ID,
    validate: { kind: "enum", values: SKIN_IDS },
    apply: { strategy: "data-attr", attr: "data-skin" },
  },
  reduceMotion: {
    key: "reduce-motion",
    storageKey: MOTION_STORAGE_KEY,
    default: DEFAULT_REDUCE_MOTION,
    validate: { kind: "enum", values: REDUCE_MOTION_VALUES },
    apply: { strategy: "data-attr", attr: "data-reduce-motion" },
  },
```

- [ ] **Step 4: Run, verify pass** (the pre-paint drift-guard now also covers the new entries automatically).
- [ ] **Step 5: Commit** — `feat(skins): register skin + reduce-motion preferences`.

---

## Task 3: Font-role tokens + wire Baloo 2 / Nunito + default skin

**Files:**
- Modify: `apps/web/app/_kindred/tokens.css`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Add role tokens to the base `:root` font block in `tokens.css`** (heirloom = serif display + read). In the `:root { --font-story: … }` block append:

```css
  --font-display: var(--font-newsreader, 'Newsreader'), Georgia, 'Times New Roman', serif;
  --font-read: var(--font-newsreader, 'Newsreader'), Georgia, 'Times New Roman', serif;
```

- [ ] **Step 2: Point global headings at the display role** in `globals.css`:

```css
h1, h2, h3 { font-family: var(--font-display); color: var(--text-body); font-weight: 500; letter-spacing: -.01em; }
```

- [ ] **Step 3: Wire the fonts + default skin in `layout.tsx`.** Add imports and instances:

```ts
import { Newsreader, Public_Sans, DM_Mono, Baloo_2, Nunito } from "next/font/google";
// …
const baloo = Baloo_2({ subsets: ["latin"], weight: ["400","500","600","700","800"], display: "swap", variable: "--font-baloo" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400","500","600","700","800"], style: ["normal","italic"], display: "swap", variable: "--font-nunito" });
```

Update the `<html>` tag — add the two font variables and the default `data-skin`:

```tsx
<html
  lang="en"
  data-theme="heirloom"
  data-skin="playful"
  className={`${newsreader.variable} ${publicSans.variable} ${dmMono.variable} ${baloo.variable} ${nunito.variable}`}
  suppressHydrationWarning
>
```

- [ ] **Step 4: Verify build + typecheck** — `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web build`. Expected: PASS (fonts resolve, no type errors). (Visual: heirloom still renders serif because base `:root` display/read = Newsreader.)
- [ ] **Step 5: Commit** — `feat(skins): font-role tokens + Baloo/Nunito + default data-skin`.

---

## Task 4: The Playful token block

**Files:**
- Create: `apps/web/app/_skins/playful.css`
- Modify: `apps/web/app/globals.css` (import it)

- [ ] **Step 1: Create `_skins/playful.css`** — override the full consumed token set (values from the approved prototype). Scope `:root[data-skin="playful"]` so it beats the base `:root` (specificity 0,2,0 > 0,1,0):

```css
/* Playful & Warm skin — token overrides. Selector specificity (0,2,0) intentionally beats the
 * base :root defaults so a component reading var(--token) re-skins with zero code changes.
 * NOTE: every token named in _skins/skin-contract.ts MUST be defined here (contract test). */
:root[data-skin="playful"] {
  /* fonts */
  --font-display: var(--font-baloo), "Baloo 2", "Trebuchet MS", system-ui, sans-serif;
  --font-story:   var(--font-nunito), "Nunito", system-ui, sans-serif; /* legacy alias (prose) */
  --font-read:    var(--font-nunito), "Nunito", system-ui, sans-serif;
  --font-ui:      var(--font-nunito), "Nunito", system-ui, sans-serif;
  /* --font-mono kept from base (DM Mono) */

  /* surfaces / ink */
  --paper-100: #FFFDF8; --paper-200: #FBF1DE; --paper-300: #FFF6E6;
  --surface-page: #FBF1DE; --surface-card: #FFFDF8; --surface-sunken: #FFF6E6;
  --text-body: #3B2F2A; --text-muted: #927F6F; --text-meta: #52443C;

  /* accent (coral) + support */
  --accent: #EF7A54; --accent-strong: #D85F39; --accent-soft: #FFE3D3; --accent-on: #FFFFFF;
  --accent-soft-0: rgba(255,227,211,0);
  --support: #3F9E93; --support-soft: #D9ECDC;

  /* lines / focus */
  --border: #F0DCC0; --border-strong: #E4C89E; --focus-ring: #EF7A54;

  /* shape — rounder, chunkier */
  --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 26px; --radius-pill: 999px;
  --border-width: 2px;

  /* shadows — soft shelf + lift */
  --shadow-sm: 0 2px 0 #F0DCC0;
  --shadow-card: 0 6px 0 #F0DCC0;
  --shadow-lift: 0 14px 30px rgba(180,120,70,0.24);

  /* motion — gentle bounce (structural motion added in Phase 2, all guarded) */
  --ease-quiet: cubic-bezier(0.34, 1.32, 0.4, 1);
  --dur-fade: 0.16s; --dur-settle: 0.30s; --dur-pulse: 2.4s;
}
```

- [ ] **Step 2: Import it in `globals.css`** (after the tokens import, so its `data-skin` rules layer on top):

```css
@import url('./_kindred/tokens.css');
@import url('./_skins/playful.css');
```

- [ ] **Step 3: Verify build** — `pnpm --filter @chronicle/web build` → PASS. (Visual: the whole app now renders Playful — coral accent, Nunito body, Baloo headings, rounded chunky cards — including unmigrated screens.)
- [ ] **Step 4: Commit** — `feat(skins): Playful token block, app-wide re-skin`.

---

## Task 5: Skin token-contract test

**Files:**
- Create: `apps/web/app/_skins/skin-contract.ts`
- Create: `apps/web/app/_skins/skin-contract.test.ts`

- [ ] **Step 1: Define the contract** — the tokens a skin MUST define so no screen renders broken:

```ts
// apps/web/app/_skins/skin-contract.ts
/** Every token a skin is REQUIRED to define. Skin-neutral tokens (type scale, spacing, touch,
 * tracking) live in the base :root and are intentionally NOT part of this per-skin contract. */
export const REQUIRED_SKIN_TOKENS = [
  "--surface-page","--surface-card","--surface-sunken",
  "--text-body","--text-muted","--text-meta",
  "--accent","--accent-strong","--accent-soft","--accent-on",
  "--support","--support-soft","--border","--border-strong","--focus-ring",
  "--shadow-sm","--shadow-card","--shadow-lift",
  "--font-display","--font-read","--font-ui","--font-story","--font-mono",
  "--radius-sm","--radius-md","--radius-lg","--radius-xl","--radius-pill",
  "--ease-quiet","--dur-fade","--dur-settle","--dur-pulse",
] as const;
```

- [ ] **Step 2: Write the test** — heirloom's token set is the base `:root` in `tokens.css`; playful's is `_skins/playful.css`. Assert each file declares every required token (`--mono` may inherit; count a `--name:` declaration anywhere in the file):

```ts
// apps/web/app/_skins/skin-contract.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SKIN_TOKENS } from "./skin-contract";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

// heirloom's tokens are the base :root + font block in tokens.css.
const heirloom = read("../_kindred/tokens.css");
const playful = read("./playful.css");

describe("skin token contract", () => {
  for (const skin of [["heirloom", heirloom], ["playful", playful]] as const) {
    const [name, css] = skin;
    it(`${name} declares every required token`, () => {
      const missing = REQUIRED_SKIN_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(css));
      expect(missing, `${name} missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Run** — `pnpm --filter @chronicle/web exec vitest run app/_skins/skin-contract.test.ts`. If heirloom is missing `--font-read`/`--font-display` the earlier Task-3 edit already added them; if playful is missing any, add it. Expected: PASS.
- [ ] **Step 4: Commit** — `test(skins): skin token-contract guard`.

---

## Task 6: Reduce-motion global guard

**Files:**
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/app/_skins/reduce-motion.test.ts`

- [ ] **Step 1: Write the guard rule** in `globals.css` (next to the existing `prefers-reduced-motion` block). It mirrors the media-query rule but keys off the user preference, so "off by preference" works even when the OS setting is not set:

```css
/* User-chosen reduce-motion (preference) — same collapse as the OS media query, opt-in per user.
 * Structural motion (Phase 2 tilt/tape/bounce) additionally guards on :not([data-reduce-motion="on"]). */
[data-reduce-motion="on"], [data-reduce-motion="on"] *, [data-reduce-motion="on"] *::before, [data-reduce-motion="on"] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
```

- [ ] **Step 2: Write a guard-presence test** (jsdom does not apply stylesheet rules to computed style, so assert the rule text exists — cheap drift guard that the guard wasn't deleted):

```ts
// apps/web/app/_skins/reduce-motion.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
const here = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(here, "../globals.css"), "utf8");

describe("reduce-motion guard", () => {
  it("collapses transitions/animations under data-reduce-motion=on", () => {
    expect(globals).toMatch(/\[data-reduce-motion="on"\][^{]*\{[^}]*transition-duration:\s*0\.001ms/s);
    expect(globals).toMatch(/\[data-reduce-motion="on"\][^{]*\{[^}]*animation-duration:\s*0\.001ms/s);
  });
});
```

- [ ] **Step 3: Run, verify pass.**
- [ ] **Step 4: Commit** — `feat(skins): user reduce-motion guard`.

---

## Task 7: Skin picker + motion toggle controls

**Files:**
- Create: `apps/web/app/_kindred/KindredSkinPicker.tsx`
- Create: `apps/web/app/_kindred/KindredMotionToggle.tsx`
- Modify: `apps/web/app/hub/settings/SettingsPanel.tsx`
- Modify: `apps/web/app/_copy/hub.ts`
- Test: `apps/web/app/_kindred/preferences/controls.test.tsx` (extend)

- [ ] **Step 1: Add copy** — in `_copy/hub.ts` under `settings`, add: `skinHeading`, `skinIntro`, `skinLabels: { playful, heirloom }`, `skinShort: { playful, heirloom }`, `skinAria`, `motionHeading`, `motionIntro`, `motionOnLabel`, `motionOffLabel`, `motionAria`. (Match the existing `palette*` shape; wording is warm and plain — e.g. skinIntro: "Choose how the app looks and feels.")

- [ ] **Step 2: Write `KindredSkinPicker.tsx`** — clone `KindredThemePicker` structure exactly, swapping `PREFERENCES.theme` → `PREFERENCES.skin`, `THEME_IDS` → `SKIN_IDS`, and the swatch map to skin previews:

```tsx
"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { SKIN_IDS, type SkinId } from "./skin-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

const pref = PREFERENCES.skin;
const SWATCH: Record<SkinId, { page: string; accent: string }> = {
  playful:  { page: "#FBF1DE", accent: "#EF7A54" },
  heirloom: { page: "#F4ECE0", accent: "#BD5B3D" },
};

export function KindredSkinPicker() {
  const [active, setActive] = useState<SkinId>(pref.default as SkinId);
  useEffect(() => {
    const skin = readPreference(pref) as SkinId;
    setActive(skin);
    applyPreference(pref, skin);
  }, []);
  function choose(skin: SkinId): void { setActive(skin); setPreference(pref, skin); }
  return (
    <div role="group" aria-label={hub.settings.skinAria} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {SKIN_IDS.map((id) => {
        const on = id === active; const sw = SWATCH[id];
        return (
          <button key={id} type="button" onClick={() => choose(id)} aria-pressed={on}
            aria-label={hub.settings.skinLabels[id]} title={hub.settings.skinLabels[id]} style={cell(on)}>
            <span style={swatch(sw.page, sw.accent)} aria-hidden="true" />
            <span style={{ lineHeight: 1.2 }}>{hub.settings.skinShort[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
function cell(on: boolean): CSSProperties { return {
  display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"12px 16px", minWidth:100,
  cursor:"pointer", borderRadius:"var(--radius-md)",
  border: on ? "2px solid var(--accent)" : "var(--border-width) solid var(--border-strong)",
  background: on ? "var(--accent-soft)" : "var(--surface-card)",
  fontFamily:"var(--font-ui)", fontSize:"var(--text-ui-sm)", fontWeight:600, color:"var(--text-body)" };
}
function swatch(page: string, accent: string): CSSProperties { return {
  width:48, height:32, borderRadius:6, background:page, border:"1px solid var(--border)",
  boxShadow:`inset 0 -6px 0 ${accent}` };
}
```

- [ ] **Step 3: Write `KindredMotionToggle.tsx`** — a two-button on/off group using `PREFERENCES.reduceMotion`:

```tsx
"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { REDUCE_MOTION_VALUES, type ReduceMotionValue } from "./motion-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

const pref = PREFERENCES.reduceMotion;
export function KindredMotionToggle() {
  const [value, setValue] = useState<ReduceMotionValue>(pref.default as ReduceMotionValue);
  useEffect(() => {
    const v = readPreference(pref) as ReduceMotionValue; setValue(v); applyPreference(pref, v);
  }, []);
  function choose(v: ReduceMotionValue): void { setValue(v); setPreference(pref, v); }
  const label = (v: ReduceMotionValue) => (v === "on" ? hub.settings.motionOnLabel : hub.settings.motionOffLabel);
  return (
    <div role="group" aria-label={hub.settings.motionAria} style={{ display: "flex", gap: 12 }}>
      {REDUCE_MOTION_VALUES.map((v) => {
        const on = v === value;
        return (
          <button key={v} type="button" onClick={() => choose(v)} aria-pressed={on} style={cell(on)}>
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}
function cell(on: boolean): CSSProperties { return {
  padding:"12px 20px", minHeight:"var(--touch-min)", cursor:"pointer", borderRadius:"var(--radius-md)",
  border: on ? "2px solid var(--accent)" : "var(--border-width) solid var(--border-strong)",
  background: on ? "var(--accent-soft)" : "var(--surface-card)",
  fontFamily:"var(--font-ui)", fontSize:"var(--text-ui-sm)", fontWeight:600, color:"var(--text-body)" };
}
```

- [ ] **Step 4: Mount in `SettingsPanel.tsx`** — add two `<section>`s (mirroring the palette section) rendering `<KindredSkinPicker />` and `<KindredMotionToggle />` with the new copy headings/intros. Put the Skin section first (it's the biggest lever).

- [ ] **Step 5: Extend `controls.test.tsx`** — mirror the existing theme/font control tests: render `KindredSkinPicker`, click "Heirloom", assert `document.documentElement.getAttribute("data-skin") === "heirloom"` and localStorage persisted; render `KindredMotionToggle`, click the on option, assert `data-reduce-motion === "on"`. (Follow the existing file's render/act/click helpers.)

- [ ] **Step 6: Run** — `pnpm --filter @chronicle/web exec vitest run app/_kindred/preferences/controls.test.tsx` → PASS.
- [ ] **Step 7: Commit** — `feat(skins): skin picker + reduce-motion toggle in settings`.

---

## Task 8: Phase 1 preflight

- [ ] **Step 1: Full CI-equivalent preflight** (CLAUDE.md gate before any master interaction):

```
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm --filter @chronicle/web build \
  && pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle
```
Expected: all green; no drizzle drift (this change touches no DB).

- [ ] **Step 2:** If green, the main agent opens a PR (author `boosey`) titled `feat(skins): Playful skin system (Phase 1 — token-only re-skin + toggles)`. Do NOT merge; human review gate.

---

## Phase 2 — outline (detailed after Phase 1 lands & is reviewed)

Phase 2 migrates the four approved flagship surfaces from inline styles to **CSS Modules** and adds Playful's structural signatures, plus 1–2 novel interactions. Its exact tasks depend on Phase 1's settled CSS-Module conventions and on which interactions survive validation, so it is intentionally an outline here — it becomes its own detailed plan (`docs/superpowers/plans/<date>-playful-flagship-surfaces.md`).

**Surfaces (independent, shippable one at a time):**
1. **Hub feed** — `hub/page.tsx` shell + nav de-clutter (8 tabs + Feed/Timeline/Search + Masonry/Column → **Stories · Album · Family · Questions** + a prominent "＋ Tell a story"; relocate view options to a secondary control), `hub/tabs/StoriesTab.tsx`, `hub/tabs/StoryBrowse.tsx`. Introduce a `feature`d story + photo-forward grid.
2. **Story card** — `_kindred/KindredStoryCard.tsx` → `KindredStoryCard.module.css`: photo-forward, odd/even tilt, tape pseudo-element, sticker/candy tags, highlighter title, `feature` variant. All structural motion gated `:root:not([data-reduce-motion="on"]):not([data-tone="solemn"])`.
3. **Story detail** — `hub/stories/[id]/StoryReadBody.tsx` (readable Nunito prose, Baloo title, warm chrome) + **novel interaction: highlight-to-treasure** over the existing Like path (progressive enhancement; open question: does it touch the Like/consent model or stay client-only — resolve first).
4. **Capture / record flow** — `s/[token]/page.tsx`, `hub/tell/*`, `hub/answer/[askId]/*` + **novel interaction: hold-to-remember** (press-and-hold record, breathing waveform; tap-to-toggle fallback; reduced-motion → static bar). `data-tone="solemn"` aware.

**Cross-cutting Phase 2 tasks:** establish the CSS-Modules pattern (first migrated file sets the convention); add `data-tone="solemn"` structural + palette dial-down and wire it to erasure/approval confirmations; per-surface a11y checks (contrast on candy tags AA, focus-visible, touch targets, font-scale intact); a "no hardcoded hex/px re-introduced" lint/guard on migrated files.

**Definition of done (Phase 2):** the four surfaces carry the Playful signature and look categorically better than the current app; ≥1 novel interaction ships as progressive enhancement over a working fallback; all suites green; no a11y regression.

---

## Self-Review (against the spec)

- **Skin axis + two skins + toggle** → Tasks 1–5, 7 (playful default, heirloom preserved via base `:root`, picker). ✓
- **Reduce-motion preference + `--motion`/guard** → Tasks 2, 6, 7. ✓
- **Registry/pre-paint/no-FOUC reuse** → Task 2 (drift guard covers new entries). ✓
- **Fonts (Baloo 2/Nunito, 4-role split)** → Task 3 + playful block Task 4. ✓
- **Token-only re-skin app-wide** → Task 4 (specificity 0,2,0 beats base). ✓
- **Skin token-contract test** → Task 5. ✓
- **Solemn tone + structural signatures + novel interactions** → Phase 2 outline (deliberately deferred, per spec §5.1 "validate 1–2"). ✓
- **A11y preserved** → Task 7 uses `--touch-min`, tokens; Phase 2 carries per-surface checks. ✓
- **Placeholder scan:** Phase 1 steps carry real code; Phase 2 is an explicitly-labeled outline, not placeholder steps in a "detailed" task. ✓
- **Type/name consistency:** `SkinId`/`SKIN_IDS`/`PREFERENCES.skin`/`data-skin` and `ReduceMotionValue`/`data-reduce-motion` used consistently across tasks. ✓
