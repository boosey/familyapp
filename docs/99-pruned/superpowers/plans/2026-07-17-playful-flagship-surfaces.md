# Playful Flagship Surfaces (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the four flagship surfaces (hub feed, story card, story detail, capture flow) from inline `style={{}}` to CSS Modules, add the Playful structural signatures (photo-forward, tilt, tape, sticker tags, highlighter), introduce the bright `#EF7A54` coral as a **decorative-only** fill, wire a per-subtree `data-tone="solemn"` dial-down, and ship two novel interactions (**hold-to-remember**, **highlight-to-treasure**) as progressive enhancement over working plain fallbacks.

**Architecture:** Phase 1 shipped a token-only re-skin — all styling is still inline. Inline styles out-specify `[data-skin]` overrides, so structural signatures require moving flagship-surface styling into CSS Modules. Module class names are hashed, so skin-scoped structural rules hook them via `:global(:root[data-skin="playful"]) .card {…}`, and are suppressed under `:global(:root[data-reduce-motion="on"]) .card` / `:global([data-tone="solemn"]) .card`. Decorative bright coral appears only as fills where no small text sits (tape/tilt-shadow/sticker backing); text/buttons keep the AA-corrected coral from Phase 1. Novel interactions land as opt-in enhancements over the existing tap-to-record and tap-to-Like paths.

**Tech Stack:** Next.js 15 (App Router) / React 19, TypeScript strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM), CSS Modules (`*.module.css`, zero config in Next 15), Vitest (jsdom for DOM/CSS-text assertions), Web Audio API (`AnalyserNode`) for the waveform. Spec: `docs/superpowers/specs/2026-07-17-playful-skin-system-design.md`.

**Branch / worktree:** Continue on `feat/playful-skin-system` in worktree `.claude/worktrees/playful-skin`. Every green surface is pushed to the branch to redeploy the Vercel preview `https://familyapp-git-feat-playful-skin-system-booseys-projects.vercel.app`. Do **not** merge PR #101; do **not** branch off master; no DB migration in this phase.

**Locked decisions (confirmed with the user 2026-07-17):**
1. **Coral:** bright `#EF7A54` is **decorative fill only** (tape / tilt-shadow / sticker backing where no small text sits). Text & buttons keep the Phase-1 AA coral (`--accent:#CC4A22`, `--accent-strong:#A83E1A`). `contrast.test.ts` is **extended, never weakened**.
2. **highlight-to-treasure:** pure client enhancement firing the **existing** `setStoryLikeAction` — no schema, no migration, no consent-model change. Fallback = tap-to-Like.
3. **Build order:** Hub feed → Story card → Story detail → Capture flow → hold-to-remember → highlight-to-treasure.
4. **`data-tone="solemn"`** is a **per-subtree attribute** (set on capture + confirmation subtrees), not a global preference.
5. **Story card retarget (see below):** the "story card" surface is the **rendered `FeedCard` in `StoryBrowse.tsx`**, not the orphan `KindredStoryCard.tsx`.

**GIT RULES for every builder/reviewer subagent (non-negotiable, put in every prompt):** work only on the current branch in the current worktree; commit there with author `boosey <boosey.boudreaux@gmail.com>` (Vercel git-author gate); **never** `git checkout`/`switch`/`reset`/`merge`/`rebase`/`push`/`branch -D`, never touch `master`, never open a PR. The main agent owns all branch/push/PR operations. Builder→reviewer subagents SHARE this worktree — do NOT give them `isolation: "worktree"`.

---

## ⚠️ Reconnaissance findings that shape this plan (read before Task 1)

1. **`KindredStoryCard.tsx` is dead code.** `grep KindredStoryCard` matches only its own file and the `_kindred/index.ts` barrel. Nothing renders it. The card users see in the hub feed is `FeedCard`, defined *inline inside* `StoryBrowse.tsx` (client, ~35 `CSSProperties` objects, lines 527–861). **Task 4 (Story card) therefore extracts `FeedCard` into a real `StoryCard` component + `StoryCard.module.css` and carries the signatures there, and deletes `KindredStoryCard.tsx` + its barrel export.**
2. **No `.module.css` exists anywhere yet.** Task 2 establishes the convention doc + the first module; every later task follows it.
3. **`data-tone` appears nowhere yet.** Task 1 introduces the attribute + CSS suppression rules; Task 6 (capture) is the first surface to *set* it.
4. **Prose in `StoryReadBody` is a single `<p>` blob** (no per-line/paragraph elements). highlight-to-treasure (Task 8) reads `window.getSelection()` over that blob — it does **not** require splitting prose into elements.
5. **The Like path** is `setStoryLikeAction(storyId, liked)` (server action in `hub/stories/[id]/actions.ts`) → core `setStoryLike` → `LikeState { likedByViewer, count, likers }`. `<LikeButton>` is mounted in `StoryDetailClient.tsx:427`.
6. **The record button** is the shared `KindredVoiceButton` (used by `ComposingEditor`, `NarratorRecorder`, `ApprovalRecorder`, `WelcomeFlow`, `AboutYouFlow`). It takes `onClick` (tap-toggle). No waveform exists anywhere. hold-to-remember (Task 7) adds an **opt-in** `holdToRecord` path so the non-capture consumers keep tap-toggle.
7. **Reduce-motion in JS:** `readPreference(PREFERENCES.reduceMotion)` from `_kindred/preferences/client.ts` returns `"on"|"off"`. Use it for the waveform static-bar fallback.

---

## File Structure

**Create**
- `apps/web/app/_skins/CSS-MODULES.md` — the one-page convention doc (Task 2).
- `apps/web/app/_skins/tone-constants.ts` — `TONE_VALUES`, `SOLEMN`/`WARM`, attr name (Task 1).
- `apps/web/app/_skins/tone-constants.test.ts` (Task 1).
- `apps/web/app/hub/page.module.css` — hub shell (Task 2).
- `apps/web/app/hub/HubTabs.module.css` — de-cluttered nav (Task 3).
- `apps/web/app/hub/tabs/StoryCard.tsx` + `StoryCard.module.css` — extracted, signature-bearing card (Task 4).
- `apps/web/app/hub/tabs/StoryCard.test.tsx` (Task 4).
- `apps/web/app/hub/tabs/StoryBrowse.module.css` — feed/timeline/search chrome (Task 5).
- `apps/web/app/hub/stories/[id]/StoryReadBody.module.css` (Task 6-detail).
- `apps/web/app/hub/ComposingEditor.module.css`, `apps/web/app/s/[token]/capture.module.css` (Task 6-capture).
- `apps/web/app/_kindred/BreathingWaveform.tsx` + `BreathingWaveform.module.css` (Task 7).
- `apps/web/app/_kindred/BreathingWaveform.test.tsx` (Task 7).
- `apps/web/app/_kindred/use-audio-level.ts` (Task 7).
- `apps/web/app/hub/stories/[id]/useTreasureHighlight.ts` + `.test.ts` (Task 8).

**Modify**
- `apps/web/app/_skins/playful.css` + `apps/web/app/_kindred/tokens.css` — add decorative/sticker/tape/highlighter tokens to BOTH skins (Task 1).
- `apps/web/app/_skins/skin-contract.ts` — add the new required token names (Task 1).
- `apps/web/app/_skins/contrast.test.ts` — add sticker ink-on-bg + title-on-highlighter pairs (Task 1).
- `apps/web/app/globals.css` — add the `data-tone` + structural-signature suppression guard (Task 1).
- `apps/web/app/hub/page.tsx`, `hub/HubTabs.tsx`, `hub/tabs/StoriesTab.tsx`, `hub/tabs/StoryBrowse.tsx` — inline → module (Tasks 2–5).
- `apps/web/app/hub/stories/[id]/StoryReadBody.tsx`, `StoryDetailClient.tsx` (Tasks 6-detail, 8).
- `apps/web/app/s/[token]/page.tsx`, `s/[token]/NarratorRecorder.tsx`, `hub/ComposingEditor.tsx`, `hub/tell/page.tsx`, `hub/answer/[askId]/page.tsx` (Task 6-capture, 7).
- `apps/web/app/_kindred/KindredVoiceButton.tsx` — opt-in `holdToRecord` + waveform slot (Task 7).
- `apps/web/lib/use-mic-recorder.ts` — expose the `MediaStream`/analyser for the waveform (Task 7).
- `apps/web/app/_copy/hub.ts` + `apps/web/app/_copy/common.ts` — new copy strings (Tasks 3, 7, 8).
- `apps/web/app/_kindred/index.ts` — drop `KindredStoryCard` export (Task 4).

**Delete**
- `apps/web/app/_kindred/KindredStoryCard.tsx` (Task 4 — dead code).

---

## Task 1: Foundation — decorative tokens, sticker/tape/highlighter palette, contrast guards, `data-tone` guard

This is the **shared-contract-first** step: every later surface consumes these tokens and the suppression guard. No component changes here — tokens + tests + one global rule.

**Files:**
- Modify: `apps/web/app/_skins/playful.css`
- Modify: `apps/web/app/_kindred/tokens.css`
- Modify: `apps/web/app/_skins/skin-contract.ts`
- Modify: `apps/web/app/_skins/contrast.test.ts`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/app/_skins/tone-constants.ts`
- Create: `apps/web/app/_skins/tone-constants.test.ts`

- [ ] **Step 1: Add the new tokens to `playful.css`** — append inside the `:root[data-skin="playful"] { … }` block (after the shadows block). Sticker `*-bg`/`*-ink` pairs are text-bearing (the tag label sits on the bg) and MUST pass AA; the decorative coral, tape, and highlighter carry no small text.

```css
  /* --- Phase 2 structural-signature palette --- */
  /* Decorative bright coral — FILL ONLY (tape, tilt-shadow, sticker backing). Never small text. */
  --deco-coral: #EF7A54;
  --tape-bg: rgba(239, 122, 84, 0.30);          /* translucent coral tape strip */
  --tilt-shadow: rgba(216, 95, 57, 0.22);        /* warm drop under tilted photos */
  --highlighter: #FFE1A6;                        /* marker wash behind titles (text = --text-body) */
  /* Sticker/candy tags — bg carries the label ink; each pair AA-guarded in contrast.test.ts */
  --sticker-coral-bg: #FFE3D3;  --sticker-coral-ink: #B24218;
  --sticker-sky-bg:   #DCEBF7;  --sticker-sky-ink:   #2F6187;
  --sticker-leaf-bg:  #E6EFD6;  --sticker-leaf-ink:  #4F6B2C;
  --sticker-gold-bg:  #F5DDB0;  --sticker-gold-ink:  #855A15;
```

- [ ] **Step 2: Add the SAME token names to `tokens.css`** — the heirloom baseline must define every contract token (the contract test scans both). Use muted, heirloom-appropriate values inside the `:root, [data-theme="heirloom"] { … }` palette block (after `--shadow-lift`). Heirloom is quieter — decorative coral maps to its terracotta, stickers to muted paper tints:

```css
  /* --- Phase 2 structural-signature palette (heirloom = muted) --- */
  --deco-coral: var(--terracotta-600);
  --tape-bg: rgba(189, 91, 61, 0.18);
  --tilt-shadow: rgba(70, 50, 30, 0.16);
  --highlighter: #EFE0C4;
  --sticker-coral-bg: #F3DACE;  --sticker-coral-ink: #A24A2F;
  --sticker-sky-bg:   #DCE6EC;  --sticker-sky-ink:   #3C566A;
  --sticker-leaf-bg:  #DEE4D6;  --sticker-leaf-ink:  #4C5B3A;
  --sticker-gold-bg:  #EDE0C4;  --sticker-gold-ink:  #6E5A2A;
```

- [ ] **Step 3: Add the new required token names to `skin-contract.ts`** — append to `REQUIRED_SKIN_TOKENS` (this forces both skins to define them or the contract test fails):

```ts
  "--deco-coral","--tape-bg","--tilt-shadow","--highlighter",
  "--sticker-coral-bg","--sticker-coral-ink",
  "--sticker-sky-bg","--sticker-sky-ink",
  "--sticker-leaf-bg","--sticker-leaf-ink",
  "--sticker-gold-bg","--sticker-gold-ink",
```

- [ ] **Step 4: Extend `contrast.test.ts`** — add the four sticker text pairs and the title-on-highlighter pair. Add a new `const` group and a `for` loop (both skins), after the existing `SURFACE_TEXT_PAIRS`:

```ts
const STICKER_PAIRS = [
  ["--sticker-coral-ink", "--sticker-coral-bg"],
  ["--sticker-sky-ink", "--sticker-sky-bg"],
  ["--sticker-leaf-ink", "--sticker-leaf-bg"],
  ["--sticker-gold-ink", "--sticker-gold-bg"],
  ["--text-body", "--highlighter"], // story title sits on the highlighter wash
] as const;
```

and inside the existing `describe("skin contrast (WCAG AA)", …)`, add a parametrised block mirroring the existing one:

```ts
  for (const [name, css] of [["playful", playful], ["heirloom", heirloom]] as const) {
    it(`${name}: sticker tags + highlighter meet AA`, () => {
      for (const [fg, bg] of STICKER_PAIRS) assertAA(css, fg, bg);
    });
  }
```

- [ ] **Step 5: Add the tone constants** — `data-tone` is a subtree attribute, not a preference. Keep the values single-sourced:

```ts
// apps/web/app/_skins/tone-constants.ts
/** Emotional tone of a UI subtree. `solemn` dials Playful whimsy down (structure + palette)
 *  on heavy surfaces (capture, erasure/approval/consent confirmations). Applied as a
 *  `data-tone` attribute on a wrapping element — NOT a global user preference. */
export const TONE_VALUES = ["warm", "solemn"] as const;
export type Tone = (typeof TONE_VALUES)[number];
export const DEFAULT_TONE: Tone = "warm";
export const TONE_ATTR = "data-tone";
```

```ts
// apps/web/app/_skins/tone-constants.test.ts
import { describe, expect, it } from "vitest";
import { TONE_VALUES, DEFAULT_TONE, TONE_ATTR } from "./tone-constants";

describe("tone constants", () => {
  it("is a warm/solemn enum defaulting to warm, written as data-tone", () => {
    expect(TONE_VALUES).toEqual(["warm", "solemn"]);
    expect(DEFAULT_TONE).toBe("warm");
    expect(TONE_ATTR).toBe("data-tone");
  });
});
```

- [ ] **Step 6: Add the structural-signature suppression guard to `globals.css`** — next to the existing `[data-reduce-motion="on"]` block. This is the single ancestor-scoped switch every module's signature rules pair with. It documents the contract; the actual per-signature `transform: none`/`background: none` overrides live in each module (they can only name their own hashed classes), but this rule also mutes the shared decorative custom-properties so token-driven decoration collapses too:

```css
/* Solemn subtree — dial Playful whimsy down (dignity guard, spec §4.5). Mutes the decorative
 * palette so tape/sticker/highlighter fills fall back to calm surfaces even before a module
 * adds its own structural suppression. Warmth (rounded type, soft shadow) is intentionally kept. */
[data-tone="solemn"] {
  --deco-coral: var(--surface-sunken);
  --tape-bg: transparent;
  --tilt-shadow: transparent;
  --highlighter: transparent;
  --sticker-coral-bg: var(--surface-sunken); --sticker-coral-ink: var(--text-meta);
  --sticker-sky-bg: var(--surface-sunken);   --sticker-sky-ink: var(--text-meta);
  --sticker-leaf-bg: var(--surface-sunken);  --sticker-leaf-ink: var(--text-meta);
  --sticker-gold-bg: var(--surface-sunken);  --sticker-gold-ink: var(--text-meta);
}
```

- [ ] **Step 7: Run the guards** —
```
pnpm --filter @chronicle/web exec vitest run app/_skins/tone-constants.test.ts app/_skins/skin-contract.test.ts app/_skins/contrast.test.ts
```
Expected: PASS. If a sticker pair fails AA, darken that `*-ink` value (it is text). Do NOT weaken `assertAA`.

- [ ] **Step 8: Commit** — `feat(skins): Phase 2 decorative palette + sticker/highlighter AA guards + data-tone`.

---

## Task 2: CSS-Modules convention + first migration (hub shell)

Establishes the pattern the whole phase reuses, on the lowest-risk surface (the static hub shell — no interactivity).

**Files:**
- Create: `apps/web/app/_skins/CSS-MODULES.md`
- Create: `apps/web/app/hub/page.module.css`
- Modify: `apps/web/app/hub/page.tsx`

- [ ] **Step 1: Write the convention doc** `apps/web/app/_skins/CSS-MODULES.md`:

```markdown
# CSS Modules convention (Phase 2 flagship migration)

Phase 1 styled everything inline. Inline styles out-specify `[data-skin]` overrides, so structural
signatures require classes. Rules:

1. **One module per migrated component**, co-located: `Foo.tsx` ↔ `Foo.module.css`.
2. **Semantic local class names** (`.card`, `.title`, `.metaRow`) — never presentational.
3. **Values come from tokens.** No hardcoded hex/px in a module except a genuinely one-off layout
   number with no token (rare; prefer adding a token). This preserves the single-source rule.
4. **Skin signatures hook hashed classes via `:global`:**
   ```css
   .card { /* base, token-driven, skin-neutral */ }
   :global(:root[data-skin="playful"]) .card:nth-child(odd) { transform: rotate(-0.6deg); }
   ```
5. **Every structural signature is suppressed under reduce-motion OR solemn:**
   ```css
   :global(:root[data-reduce-motion="on"]) .card,
   :global([data-tone="solemn"]) .card { transform: none; box-shadow: var(--shadow-card); }
   ```
   Motion (transitions, breathing) additionally collapses via the global duration guard in
   `globals.css`; static tilt/tape are killed by the rule above.
6. **Dynamic values** (a computed rotation, an audio level) → set a CSS custom property inline
   (`style={{ "--i": index }}`) and consume it in the module. JS math stays in TS.
7. **Focus:** every interactive element keeps a visible `:focus-visible` outline in the module.
```

- [ ] **Step 2: Write `page.module.css`** — port the shell inline objects (hub/page.tsx lines 244–372) verbatim into classes. The shell has no signatures yet; it just proves the pattern:

```css
.main { min-height: 100dvh; background: var(--surface-page); }
.container { max-width: 900px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 32px); }
.header {
  padding: 28px 0 0;
  border-bottom: var(--border-width) solid var(--border);
  display: flex; flex-direction: column; gap: 16px;
}
.titleRow {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
}
.familyName {
  font-family: var(--font-display); /* was --font-story; Playful splits display from read */
  font-size: clamp(1.75rem, 4vw, var(--text-display));
  font-weight: 400; color: var(--text-body); margin: 0;
  letter-spacing: var(--tracking-tight);
}
.emptyCard {
  background: var(--surface-card);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg); padding: 30px; text-align: center;
}
```

- [ ] **Step 3: Wire the module in `page.tsx`** — `import styles from "./page.module.css";` and replace each corresponding `style={{…}}` with `className={styles.main}` etc. Leave any purely-dynamic style (none here) inline. Note the `--font-story` → `--font-display` change on the family name is deliberate (Playful title role).

- [ ] **Step 4: Verify build + a visual smoke** —
```
pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web build
```
Expected: PASS. (Manual: the hub still renders identically under heirloom; under playful the family name now uses Baloo.)

- [ ] **Step 5: Commit** — `feat(hub): migrate hub shell to CSS Modules; establish convention`.

---

## Task 3: Nav de-clutter (HubTabs → Stories · Album · Family · Questions + "＋ Tell a story")

**Highest design-risk task — flag it for the most careful cold review.** Today: 8 tabs (Stories, Album, To answer, Ask a question, Your asks, Family, Invite, Requests) + child-rendered controls. Target primary bar: **Stories · Album · Family · Questions** + a prominent **＋ Tell a story** action. "Questions" consolidates *To answer / Ask a question / Your asks* into one destination with a secondary sub-nav; *Invite* and *Requests* (already steward/member-conditional) move into an **overflow "More ▾"** menu. Routing keys and server gating are unchanged — only the presentation regroups, so no server authz risk.

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (the `tabs` array, lines 210–240; add the CTA + primary/secondary split)
- Modify: `apps/web/app/hub/HubTabs.tsx` (render primary tabs + overflow + CTA)
- Create: `apps/web/app/hub/HubTabs.module.css`
- Modify: `apps/web/app/_copy/hub.ts` (`shell` namespace: `tabQuestions` reuse + `tellCta`, `moreLabel`, `moreAria`, `questionsSubnav` labels)
- Test: `apps/web/app/hub/HubTabs.test.tsx` (create)

- [ ] **Step 1: Add copy** — in `_copy/hub.ts` under `shell`, add:
```ts
    tellCta: "＋ Tell a story",
    tellCtaAria: "Start telling a new story",
    moreLabel: "More",
    moreAria: "More sections",
    questionsSubToAnswer: "To answer",
    questionsSubAsk: "Ask a question",
    questionsSubYourAsks: "Your asks",
```
Keep the existing `tabStories/tabAlbum/tabFamily/tabQuestions` strings; `tabQuestions` becomes the primary "Questions" label.

- [ ] **Step 2: Restructure the `tabs` array in `page.tsx`** — split into `primaryTabs` and `overflowTabs`, and pass the CTA target. The `questions` primary key routes to `?tab=questions`; the three ask-related surfaces render inside it via a sub-nav (existing `StoriesTab`/asks components are reached by `?tab=questions&sub=…`). Concretely, replace the single `tabs` array with:

```ts
const primaryTabs = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  {
    key: "questions",
    label: hub.shell.tabQuestions,
    badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
  },
];
const overflowTabs = [
  ...(inviteTabVisible(activeFamilies.length) ? [{ key: "invite", label: hub.shell.tabInvite }] : []),
  ...(requestsTabVisible(activeFamilies.length, pendingRequests.length, decidedRequests.length)
    ? [{ key: "requests", label: hub.shell.tabRequests, badge: pendingRequests.length > 0 ? pendingRequests.length : undefined }]
    : []),
];
```
Keep `validTabs` covering ALL keys (stories, album, family, questions, ask, asks, invite, requests) so deep links still resolve. Map legacy `?tab=ask`/`?tab=asks`/`?tab=questions` all onto the `questions` primary destination when computing which primary tab is visually active:
```ts
const primaryActive =
  ["questions", "ask", "asks"].includes(activeTab) ? "questions"
  : ["invite", "requests"].includes(activeTab) ? activeTab // stays selectable via overflow
  : activeTab;
```
Pass both arrays + the CTA into `HubTabsNav`/`HubTabs`.

- [ ] **Step 3: Write `HubTabs.module.css`** — nav + tab + badge + the prominent CTA + overflow menu. The CTA uses the AA `--accent` (white text — it is text-bearing, so NOT the decorative coral):

```css
.nav { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); flex-wrap: wrap; }
.tab {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: var(--radius-md); border: none;
  background: transparent; color: var(--text-meta);
  font-family: var(--font-ui); font-size: var(--text-ui-sm); font-weight: 500;
  cursor: pointer; min-height: var(--touch-min);
  transition: background var(--dur-fade) var(--ease-quiet), color var(--dur-fade) var(--ease-quiet);
}
.tab:hover { background: var(--surface-sunken); }
.tab[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
.tab:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill);
  background: var(--accent); color: var(--accent-on);
  font-family: var(--font-ui); font-size: 0.75rem; font-weight: 700; line-height: 1;
}
.spacer { flex: 1 1 auto; }
.cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-radius: var(--radius-pill); border: none;
  background: var(--accent); color: var(--accent-on);
  font-family: var(--font-ui); font-size: var(--text-ui-sm); font-weight: 700;
  min-height: var(--touch-min); cursor: pointer; text-decoration: none;
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-fade) var(--ease-quiet), background var(--dur-fade) var(--ease-quiet);
}
.cta:hover { background: var(--accent-strong); }
.cta:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
/* Playful signature: the CTA gives a tiny confident bounce on hover (motion-gated). */
:global(:root[data-skin="playful"]) .cta:hover { transform: translateY(-1px); }
:global(:root[data-reduce-motion="on"]) .cta:hover { transform: none; }
.more { position: relative; }
.moreMenu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
  display: flex; flex-direction: column; gap: 2px; min-width: 180px; padding: 6px;
  background: var(--surface-card); border: var(--border-width) solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lift);
}
```

- [ ] **Step 4: Rewrite `HubTabs.tsx`** to render `primaryTabs` as `.tab` buttons, a `.spacer`, the `.cta` link to `/hub/tell`, and — when `overflowTabs.length > 0` — a "More ▾" button toggling `.moreMenu`. Preserve the existing `role="tablist"`/`role="tab"`/`aria-selected` semantics on the primary tabs; the CTA is a plain link (`<a href="/hub/tell">`), the More menu items are `role="menuitem"` buttons calling the same `onChange(key)`. Keep the `?families=` preservation already in `HubTabsNav`.

- [ ] **Step 5: Write `HubTabs.test.tsx`** (jsdom) — assert the de-clutter contract:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HubTabs } from "./HubTabs";
import { hub } from "@/app/_copy";

const primary = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  { key: "questions", label: hub.shell.tabQuestions },
];

describe("HubTabs de-clutter", () => {
  it("renders exactly the four primary tabs plus a Tell-a-story CTA", () => {
    render(<HubTabs primaryTabs={primary} overflowTabs={[]} active="stories" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("link", { name: hub.shell.tellCtaAria })).toHaveAttribute("href", "/hub/tell");
  });
  it("tucks overflow tabs behind a More menu", () => {
    const onChange = vi.fn();
    render(
      <HubTabs primaryTabs={primary} overflowTabs={[{ key: "requests", label: hub.shell.tabRequests }]}
        active="stories" onChange={onChange} />,
    );
    expect(screen.queryByRole("tab", { name: hub.shell.tabRequests })).toBeNull(); // not a primary tab
    fireEvent.click(screen.getByRole("button", { name: hub.shell.moreAria }));
    fireEvent.click(screen.getByRole("menuitem", { name: hub.shell.tabRequests }));
    expect(onChange).toHaveBeenCalledWith("requests");
  });
});
```
(Match the actual prop names you settle on in Step 4; update the existing `HubTabs` callers/tests accordingly.)

- [ ] **Step 6: Run** — `pnpm --filter @chronicle/web exec vitest run app/hub/HubTabs.test.tsx` → PASS. Then `typecheck`.
- [ ] **Step 7: Commit** — `feat(hub): de-clutter primary nav to 4 tabs + Tell-a-story CTA + overflow`.

---

## Task 4: Story card — extract `FeedCard` → `StoryCard` + signatures; delete the orphan

Retargets the "story card" surface to the **rendered** card. Extract `FeedCard` (currently inline in `StoryBrowse.tsx`) into `hub/tabs/StoryCard.tsx` + `StoryCard.module.css`, add the Playful signatures, add a `feature` variant, then delete the dead `KindredStoryCard`.

**Files:**
- Create: `apps/web/app/hub/tabs/StoryCard.tsx`
- Create: `apps/web/app/hub/tabs/StoryCard.module.css`
- Create: `apps/web/app/hub/tabs/StoryCard.test.tsx`
- Modify: `apps/web/app/hub/tabs/StoryBrowse.tsx` (render `<StoryCard>` in place of inline `FeedCard`)
- Modify: `apps/web/app/_kindred/index.ts` (remove `KindredStoryCard` export)
- Delete: `apps/web/app/_kindred/KindredStoryCard.tsx`

- [ ] **Step 1: Write `StoryCard.tsx`** — a client component taking the existing `StoryItem` fields plus `variant: "feed" | "feature"` and `index` (for odd/even tilt). Move the `FeedCard` JSX out of `StoryBrowse.tsx` unchanged in structure, swapping inline styles for `styles.*` classes and passing the tilt index as a CSS var:

```tsx
"use client";
import type { StoryItem } from "./story-browse-types";
import styles from "./StoryCard.module.css";

export function StoryCard({
  item, index, variant = "feed", view,
}: {
  item: StoryItem;
  index: number;
  variant?: "feed" | "feature";
  view: "masonry" | "column";
}) {
  const cover = item.coverPhotoId;
  const extras = item.photoIds.filter((id) => id !== item.coverPhotoId);
  return (
    <a
      href={item.href}
      className={[styles.card, styles[variant], styles[view]].join(" ")}
      style={{ "--i": index } as React.CSSProperties}
    >
      {cover && (
        <span className={styles.photoWrap}>
          <img className={styles.cover} src={`/api/album-photo/${cover}`} alt="" loading="lazy" />
          {/* tape strip is a decorative pseudo-element in the module */}
        </span>
      )}
      <span className={styles.body}>
        {item.isNew && <span className={styles.newBadge}>{/* copy: hub.stories.newBadge */}</span>}
        <span className={styles.title}>{item.title}</span>
        {item.eventLabel && <span className={styles.meta}>{item.eventLabel}</span>}
        <span className={styles.tags}>
          {item.tags.map((t, i) => (
            <span key={t} className={[styles.sticker, styles[`sticker${i % 4}` as const]].join(" ")}>{t}</span>
          ))}
          {item.families.map((f) => (
            <span key={f.id} className={styles.familyTag}>{f.shortName ?? f.name}</span>
          ))}
        </span>
        {extras.length > 0 && (
          <span className={styles.thumbRow}>
            {extras.map((id) => (
              <img key={id} className={styles.thumb} src={`/api/album-photo/${id}`} alt="" loading="lazy" />
            ))}
          </span>
        )}
      </span>
    </a>
  );
}
```
(Preserve the exact copy/aria/label details from the current `FeedCard` — pull them across, do not invent. The `sticker0..3` classes rotate the four sticker palettes.)

- [ ] **Step 2: Write `StoryCard.module.css`** — base (token-driven, skin-neutral) + Playful signatures (all suppressed under reduce-motion/solemn). This is the visual heart of the phase:

```css
.card {
  display: flex; width: 100%; text-decoration: none; cursor: pointer; position: relative;
  background: var(--surface-card); border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-card); color: inherit;
}
.column { flex-direction: row; gap: 22px; padding: 22px; }
.masonry { flex-direction: column; gap: 12px; padding: 18px; break-inside: avoid; margin-bottom: 18px; }
.photoWrap { position: relative; display: block; }
.cover {
  width: 100%; height: auto; max-height: 320px; object-fit: cover;
  border-radius: var(--radius-md); background: var(--surface-sunken); display: block;
}
.column .cover { flex: 0 0 auto; width: 120px; height: 120px; }
.body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.title {
  font-family: var(--font-display); font-weight: 600; font-size: var(--text-story-lg);
  line-height: var(--leading-snug); color: var(--text-body); margin: 10px 0 6px;
}
.meta {
  font-family: var(--font-mono); font-size: var(--text-label); color: var(--text-meta);
  letter-spacing: var(--tracking-mono); text-transform: uppercase;
}
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sticker {
  font-family: var(--font-ui); font-size: var(--text-label); font-weight: 700;
  border-radius: var(--radius-pill); padding: 5px 13px;
}
.sticker0 { background: var(--sticker-coral-bg); color: var(--sticker-coral-ink); }
.sticker1 { background: var(--sticker-sky-bg);   color: var(--sticker-sky-ink); }
.sticker2 { background: var(--sticker-leaf-bg);  color: var(--sticker-leaf-ink); }
.sticker3 { background: var(--sticker-gold-bg);  color: var(--sticker-gold-ink); }
.familyTag {
  font-family: var(--font-mono); font-size: var(--text-label); font-weight: 500;
  letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--accent-strong); background: var(--accent-soft);
  border-radius: var(--radius-pill); padding: 5px 13px;
}
.thumbRow { display: flex; gap: 8px; margin-top: 12px; }
.thumb { width: 52px; height: 52px; object-fit: cover; border-radius: var(--radius-sm); }
.newBadge {
  position: absolute; top: 16px; right: 20px; font-family: var(--font-mono);
  font-size: var(--text-label); font-weight: 500; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--accent-strong);
}
.card:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.feature { /* 2-up hero: wider, photo leads full-bleed */ }
.feature .cover { max-height: 460px; }
.feature .title { font-size: var(--text-display); }

/* ---- Playful structural signatures (photo-forward, tilt, tape, sticker rotation) ---- */
:global(:root[data-skin="playful"]) .card {
  transform: rotate(calc((mod(var(--i, 0), 2) - 0.5) * 1.1deg)); /* odd -0.55°, even +0.55° */
  transition: transform var(--dur-settle) var(--ease-quiet), box-shadow var(--dur-settle) var(--ease-quiet);
}
:global(:root[data-skin="playful"]) .card:hover {
  transform: rotate(0deg) translateY(-2px); box-shadow: var(--shadow-lift);
}
/* Tape strip — decorative bright coral, no text ever sits on it. */
:global(:root[data-skin="playful"]) .photoWrap::before {
  content: ""; position: absolute; top: -10px; left: 50%; width: 84px; height: 22px;
  transform: translateX(-50%) rotate(-4deg); background: var(--tape-bg);
  border-radius: 2px; box-shadow: 0 1px 2px var(--tilt-shadow);
}
/* Highlighter wash behind the title (text stays --text-body; AA-guarded in Task 1). */
:global(:root[data-skin="playful"]) .title {
  background-image: linear-gradient(var(--highlighter), var(--highlighter));
  background-repeat: no-repeat; background-position: 0 78%; background-size: 100% 42%;
}
/* Suppress ALL structural signatures under reduce-motion OR solemn. */
:global(:root[data-reduce-motion="on"]) .card,
:global([data-tone="solemn"]) .card { transform: none; }
:global(:root[data-reduce-motion="on"]) .card:hover,
:global([data-tone="solemn"]) .card:hover { transform: none; box-shadow: var(--shadow-card); }
:global([data-tone="solemn"]) .photoWrap::before { display: none; }
:global([data-tone="solemn"]) .title { background-image: none; }
```
(Note: `mod()` is CSS-native in modern browsers; if the build target rejects it, fall back to setting `--tilt` inline in TS: `style={{ "--tilt": index % 2 ? "-0.55deg" : "0.55deg" }}` and `transform: rotate(var(--tilt))`. Prefer the inline-var form if unsure — it keeps the math in TS per the convention doc.)

- [ ] **Step 3: Write `StoryCard.test.tsx`** (jsdom) — assert structure + that stickers rotate + that the card links out:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoryCard } from "./StoryCard";
import type { StoryItem } from "./story-browse-types";

const item: StoryItem = {
  id: "s1", title: "Grandpa's boat", summary: null, prose: "…", tags: ["boats", "1962", "naples"],
  personId: "p1", personName: "Al", eraYear: 1962, eraLabel: "Naples", eventLabel: "1962 · NAPLES",
  families: [{ id: "f1", name: "Boudreaux", shortName: "B" }], isNew: true,
  coverPhotoId: "ph1", photoIds: ["ph1", "ph2"], href: "/hub/stories/s1",
};

describe("StoryCard", () => {
  it("renders title, event label, a cover image, and one sticker per tag", () => {
    render(<StoryCard item={item} index={0} view="masonry" />);
    expect(screen.getByText("Grandpa's boat")).toBeTruthy();
    expect(screen.getByText("1962 · NAPLES")).toBeTruthy();
    const imgs = screen.getAllByRole("img");
    expect(imgs[0].getAttribute("src")).toContain("/api/album-photo/ph1");
    for (const t of item.tags) expect(screen.getByText(t)).toBeTruthy();
  });
  it("links to the story detail", () => {
    render(<StoryCard item={item} index={1} view="column" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/hub/stories/s1");
  });
});
```

- [ ] **Step 4: Swap in `StoryBrowse.tsx`** — replace the inline `FeedCard` renders (masonry + column) with `<StoryCard item={item} index={i} view={feedView} />`, passing `variant="feature"` for the first cover-bearing item in masonry feed. Delete the now-unused `FeedCard`-specific `CSSProperties` objects that moved into the module (leave the mode/segment/timeline/search ones — Task 5 handles those). Keep all data wiring (`extras`, byte routes, `isNew`) intact.

- [ ] **Step 5: Delete the orphan** — `rm apps/web/app/_kindred/KindredStoryCard.tsx` and remove its line from `apps/web/app/_kindred/index.ts`.

- [ ] **Step 6: Run** — `pnpm --filter @chronicle/web exec vitest run app/hub/tabs/StoryCard.test.tsx` → PASS; then `typecheck` (catches any dangling `KindredStoryCard` import) and `build`.
- [ ] **Step 7: Commit** — `feat(hub): photo-forward StoryCard with tilt/tape/stickers/highlighter; drop dead KindredStoryCard`.

---

## Task 5: Hub feed chrome — StoryBrowse modes + StoriesTab + featured layout

Migrate the remaining `StoryBrowse` chrome (mode segmented control, feed-view toggle, timeline, search) and `StoriesTab` (resume list, empty states) to modules, and relocate the Feed/Timeline/Search + Masonry/Column controls into a **secondary "view options" row** (spec: not front-and-center).

**Files:**
- Create: `apps/web/app/hub/tabs/StoryBrowse.module.css`
- Modify: `apps/web/app/hub/tabs/StoryBrowse.tsx`
- Create: `apps/web/app/hub/tabs/StoriesTab.module.css`
- Modify: `apps/web/app/hub/tabs/StoriesTab.tsx`

- [ ] **Step 1: Write `StoryBrowse.module.css`** — port the remaining named `CSSProperties` (subnavRow, segmentGroup, modePill, timelineRow, searchInput, container layouts) into classes 1:1 (values already token-driven). Add the `.viewOptions` secondary row (smaller, right-aligned, quieter than the primary tabs):
```css
.viewOptions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 4px 0 18px; }
.segmentGroup {
  display: inline-flex; gap: 4px; background: var(--surface-sunken);
  border: var(--border-width) solid var(--border); border-radius: var(--radius-pill); padding: 4px;
}
.modePill {
  padding: 8px 16px; border: none; cursor: pointer; border-radius: var(--radius-pill);
  font-family: var(--font-ui); font-size: var(--text-label); font-weight: 600; white-space: nowrap;
  background: transparent; color: var(--text-muted);
}
.modePill[aria-selected="true"], .modePill[aria-checked="true"] {
  background: var(--surface-card); color: var(--accent-strong); box-shadow: var(--shadow-sm);
}
.modePill:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.masonry { column-width: 320px; column-gap: 18px; }
.column { display: flex; flex-direction: column; gap: 18px; }
.timelineRow {
  display: flex; align-items: center; gap: 18px; width: 100%; text-decoration: none; cursor: pointer;
  background: var(--surface-card); border: var(--border-width) solid var(--border);
  border-radius: var(--radius-md); padding: 16px 20px;
}
.searchInput {
  width: 100%; padding: 16px 20px; font-family: var(--font-ui); font-size: var(--text-ui);
  color: var(--text-body); background: var(--surface-card);
  border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-md); outline: none;
}
.searchInput:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
```

- [ ] **Step 2: Rewire `StoryBrowse.tsx`** — `import styles from "./StoryBrowse.module.css"`; replace the inline objects with classes; move the mode control + feed-view toggle into the `.viewOptions` row rendered ABOVE the grid but after any section heading (secondary placement). Keep all mode/view state, localStorage `hub:feedView`, and the `data-view` attributes unchanged.

- [ ] **Step 3: Write `StoriesTab.module.css`** — port the resume-list + empty-state inline objects (StoriesTab.tsx lines 138–227) 1:1 into `.wrap`, `.resumeHeading`, `.resumeList`, `.resumeItem`, `.resumeLink`, `.emptyText`. (Straight port; values already tokenised.)

- [ ] **Step 4: Rewire `StoriesTab.tsx`** to use the module.

- [ ] **Step 5: Verify** — `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web build` → PASS. (Manual smoke: feed shows the featured card first, view options sit quietly top-right, masonry/column still toggle and persist.)
- [ ] **Step 6: Commit** — `feat(hub): migrate feed chrome to modules; relocate view options to secondary row`.

At this point **push the branch** (main agent) — the hub-feed surface is complete and the preview should show the photo-forward, de-cluttered feed.

---

## Task 6: Story detail + capture flow — migrate to modules; capture is solemn-aware

Two surfaces, one task (both are read/record chrome with no new interaction yet — interactions come in Tasks 7–8).

**Files:**
- Create: `apps/web/app/hub/stories/[id]/StoryReadBody.module.css`
- Modify: `apps/web/app/hub/stories/[id]/StoryReadBody.tsx`
- Create: `apps/web/app/hub/ComposingEditor.module.css`
- Modify: `apps/web/app/hub/ComposingEditor.tsx`
- Create: `apps/web/app/s/[token]/capture.module.css`
- Modify: `apps/web/app/s/[token]/page.tsx`, `apps/web/app/hub/tell/page.tsx`, `apps/web/app/hub/answer/[askId]/page.tsx`

- [ ] **Step 1: `StoryReadBody.module.css`** — port the prose/transcript/tablist/tab inline objects; point prose at `--font-read` (Nunito), the (future) title at `--font-display`:
```css
.prose {
  font-family: var(--font-read); font-weight: 400;
  font-size: clamp(var(--text-story), 2.5vw, var(--text-story-lg));
  line-height: 1.65; color: var(--text-body); white-space: pre-wrap; text-wrap: pretty; margin: 0 0 60px;
}
.transcript {
  font-family: var(--font-mono); font-size: var(--text-ui-sm); line-height: 1.7;
  color: var(--text-muted); white-space: pre-wrap; text-wrap: pretty; margin: 0 0 60px;
}
.tablist {
  display: inline-flex; gap: 4px; background: var(--surface-sunken);
  border: var(--border-width) solid var(--border); border-radius: var(--radius-pill); padding: 4px; margin: 0 0 20px;
}
.tab {
  padding: 9px 20px; border: none; cursor: pointer; border-radius: var(--radius-pill);
  font-family: var(--font-ui); font-size: var(--text-ui-sm); font-weight: 600;
  background: transparent; color: var(--text-muted);
}
.tab[aria-selected="true"] { background: var(--surface-card); color: var(--accent-strong); box-shadow: var(--shadow-sm); }
.tab:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
```
- [ ] **Step 2: Rewire `StoryReadBody.tsx`** to the module (keep the prose/transcript toggle logic + the single `<p>` prose blob — highlight-to-treasure needs the blob).

- [ ] **Step 3: `ComposingEditor.module.css` + `s/[token]/capture.module.css`** — port the capture footer + surface inline styles (ComposingEditor footer lines ~1028–1050; `/s/[token]` header/prompt/wrapper). Straight ports; no signatures on capture — it stays calm.

- [ ] **Step 4: Set `data-tone="solemn"` on the capture subtree** — wrap the recording UI. In `ComposingEditor.tsx` put `data-tone="solemn"` on the outer capture container `<div>`; in `s/[token]/page.tsx` put it on the `<main>`. This dials whimsy down on the emotional core per spec §4.5 (the Task-1 guard mutes decorative tokens; the Task-4/7 modules kill tilt/tape/breathing under it). Add a small assertion to an existing capture test (or a new `capture-tone.test.tsx`) that the container carries `data-tone="solemn"`.

- [ ] **Step 5: Verify** — `typecheck && build` → PASS. Manual: story detail reads in Nunito with warm chrome; capture surfaces render calm (no tape/tilt) even under playful.
- [ ] **Step 6: Commit** — `feat(story,capture): migrate detail + capture to modules; solemn-tone the capture subtree`. **Push the branch** (two more surfaces visible in preview).

---

## Task 7: hold-to-remember (press-and-hold record + breathing waveform)

Opt-in on the shared `KindredVoiceButton` so only capture surfaces change. Press-and-hold to record; a warm breathing waveform reflects the mic; **fallbacks:** tap-to-toggle (motor accessibility, always available) and a static level bar under reduce-motion. Solemn-aware (breathing → static).

**Files:**
- Modify: `apps/web/lib/use-mic-recorder.ts` (expose the live `MediaStream`)
- Create: `apps/web/app/_kindred/use-audio-level.ts`
- Create: `apps/web/app/_kindred/BreathingWaveform.tsx` + `BreathingWaveform.module.css`
- Create: `apps/web/app/_kindred/BreathingWaveform.test.tsx`
- Modify: `apps/web/app/_kindred/KindredVoiceButton.tsx`
- Modify: `apps/web/app/hub/ComposingEditor.tsx`, `apps/web/app/s/[token]/NarratorRecorder.tsx` (enable `holdToRecord`)
- Modify: `apps/web/app/_copy/common.ts` (`voiceButton.holdToSpeak`, `voiceButton.releaseToFinish`)

- [ ] **Step 1: Expose the stream from `use-mic-recorder.ts`** — the hook already calls `getUserMedia`. Return the active `MediaStream | null` (it holds it internally to stop tracks). Add `stream` to the returned object; set it when recording starts, null on stop. Write a unit test asserting the returned shape includes `stream` (mock `navigator.mediaDevices.getUserMedia`).

- [ ] **Step 2: `use-audio-level.ts`** — a hook turning a `MediaStream` into a smoothed 0–1 level via `AnalyserNode` + `requestAnimationFrame`, returning `0` when `stream` is null or when `reduceMotion` is on (so callers don't animate):
```ts
"use client";
import { useEffect, useRef, useState } from "react";

/** Smoothed RMS level (0–1) of a live mic stream. Returns a frozen 0 when disabled
 *  (no stream, or reduced motion) so the waveform can render a static bar instead. */
export function useAudioLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!stream || !enabled) { setLevel(0); return; }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const c = (v - 128) / 128; sum += c * c; }
      const rms = Math.sqrt(sum / buf.length);
      setLevel((prev) => prev * 0.7 + Math.min(1, rms * 2.2) * 0.3); // smoothing
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      src.disconnect();
      void ctx.close();
    };
  }, [stream, enabled]);
  return level;
}
```

- [ ] **Step 3: `BreathingWaveform.tsx` + module** — N bars whose height follows `level`; under reduce-motion it renders a single static level bar. TDD it first:
```tsx
// BreathingWaveform.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BreathingWaveform } from "./BreathingWaveform";

describe("BreathingWaveform", () => {
  it("renders animated bars when motion is allowed", () => {
    const { container } = render(<BreathingWaveform level={0.5} reduceMotion={false} bars={5} />);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(5);
  });
  it("renders a single static level bar under reduced motion", () => {
    const { container } = render(<BreathingWaveform level={0.5} reduceMotion={true} bars={5} />);
    expect(container.querySelector('[data-static-bar="true"]')).toBeTruthy();
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
  });
});
```
```tsx
// BreathingWaveform.tsx
"use client";
import type { CSSProperties } from "react";
import styles from "./BreathingWaveform.module.css";

export function BreathingWaveform({ level, reduceMotion, bars = 7 }:
  { level: number; reduceMotion: boolean; bars?: number }) {
  if (reduceMotion) {
    return <div className={styles.staticTrack} aria-hidden>
      <div className={styles.staticBar} data-static-bar="true" style={{ "--lvl": level } as CSSProperties} />
    </div>;
  }
  return <div className={styles.track} aria-hidden>
    {Array.from({ length: bars }, (_, i) => (
      <span key={i} data-bar className={styles.bar}
        style={{ "--lvl": level, "--i": i } as CSSProperties} />
    ))}
  </div>;
}
```
Module: bars scale by `--lvl` with a per-bar phase (`--i`) and the `--dur-pulse` breathing when idle; the static bar is a token-coloured fill width `calc(var(--lvl)*100%)`. Colour the bars with `--accent` (they carry no text). Decorative motion additionally guarded by the global reduce-motion duration collapse.

- [ ] **Step 4: Add `holdToRecord` to `KindredVoiceButton.tsx`** — new optional props `holdToRecord?: boolean`, `onHoldStart?: () => void`, `onHoldEnd?: () => void`, `waveform?: ReactNode`. When `holdToRecord` is true: `onPointerDown` → `onHoldStart`, `onPointerUp`/`onPointerLeave`/`onPointerCancel` → `onHoldEnd`; render `{waveform}` in place of the idle pulse while `listening`. Keep `onClick` working (tap-to-toggle) as the fallback — a short press fires pointerdown+pointerup, so map: if not `holdToRecord`, behave exactly as today. Update the caption to `common.voiceButton.holdToSpeak`/`releaseToFinish` when `holdToRecord`. Preserve `aria-pressed`, `aria-label`, disabled handling. Add a jsdom test: with `holdToRecord`, `pointerDown` calls `onHoldStart` and `pointerUp` calls `onHoldEnd`; without it, `click` still calls `onClick`.

- [ ] **Step 5: Wire the capture surfaces** — in `ComposingEditor.tsx` and `NarratorRecorder.tsx`, read `const reduceMotion = readPreference(PREFERENCES.reduceMotion) === "on"`, get `stream` from the recorder hook, compute `level = useAudioLevel(stream, !reduceMotion)`, and pass `holdToRecord onHoldStart={start} onHoldEnd={finish} waveform={<BreathingWaveform level={level} reduceMotion={reduceMotion} />}` to `KindredVoiceButton`. Because the button sits inside the `data-tone="solemn"` capture subtree (Task 6), the breathing is already palette-calm; keep the press-hold + waveform (it's the point of the surface) but ensure reduce-motion → static bar. The tap-to-toggle path remains for motor accessibility (a tap still starts/stops).

- [ ] **Step 6: Run** — `pnpm --filter @chronicle/web exec vitest run app/_kindred/BreathingWaveform.test.tsx app/_kindred/KindredVoiceButton.test.tsx lib/use-mic-recorder.test.ts` → PASS. Then `typecheck && build`.
- [ ] **Step 7: Commit** — `feat(capture): hold-to-remember press-and-hold record + breathing waveform (reduce-motion + tap fallbacks)`. **Push the branch.**

---

## Task 8: highlight-to-treasure (drag-to-Like over the existing Like path)

Pure client enhancement on story detail. Dragging across prose leaves a warm highlighter swipe and fires the **existing** `setStoryLikeAction(storyId, true)`. Fallback = the existing tap `<LikeButton>` (untouched). No schema, no migration.

**Files:**
- Create: `apps/web/app/hub/stories/[id]/useTreasureHighlight.ts` + `.test.ts`
- Modify: `apps/web/app/hub/stories/[id]/StoryReadBody.tsx` (attach the gesture + swipe visual)
- Modify: `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx` (pass `storyId`, `canReact`, and a like callback into `StoryReadBody`)
- Modify: `apps/web/app/hub/stories/[id]/StoryReadBody.module.css` (the `.treasure` swipe)
- Modify: `apps/web/app/_copy/hub.ts` (`stories.treasureAria`, `stories.treasureHint`)

- [ ] **Step 1: `useTreasureHighlight.ts`** — a hook that, given a container ref + `enabled` + `onTreasure`, listens for `mouseup`/`touchend`, reads `window.getSelection()`, and if a non-empty selection lies within the container, calls `onTreasure(selectedText)` and clears the selection. Gate on `enabled` (false when `!canReact`, or under reduce-motion the *visual* is reduced but the action still works). Keep it dependency-light and SSR-safe (guard `window`).
```ts
"use client";
import { useEffect, type RefObject } from "react";

export function useTreasureHighlight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onTreasure: (text: string) => void,
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const handle = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      const text = sel.toString().trim();
      if (text.length === 0) return;
      onTreasure(text);
      sel.removeAllRanges();
    };
    el.addEventListener("mouseup", handle);
    el.addEventListener("touchend", handle);
    return () => {
      el.removeEventListener("mouseup", handle);
      el.removeEventListener("touchend", handle);
    };
  }, [ref, enabled, onTreasure]);
}
```

- [ ] **Step 2: `useTreasureHighlight.test.ts`** (jsdom) — render a container with text, mock `window.getSelection` to return a range inside it, dispatch `mouseup`, assert `onTreasure` fired with the text; then a collapsed/empty selection fires nothing; then a selection outside the container fires nothing.

- [ ] **Step 3: Wire `StoryReadBody`** — accept new optional props `onTreasure?: (text: string) => void` and `canTreasure?: boolean`; attach a `ref` to the prose container; call `useTreasureHighlight(proseRef, !!canTreasure && !!onTreasure, onTreasure ?? noop)`. On a successful treasure, briefly paint the selected range with the `.treasure` highlighter class (a transient span wrap or a CSS `::selection`-style flash) — keep it best-effort and non-destructive to the prose text. Add `aria` describing the gesture (`hub.stories.treasureHint`) as a visually-muted hint near the prose.

- [ ] **Step 4: Wire `StoryDetailClient`** — pass `storyId`, `canTreasure={canReact}`, and `onTreasure={(text) => { void setStoryLikeAction(storyId, true); /* optimistic: bump the LikeButton state */ }}` into `StoryReadBody`. Reuse the existing `LikeButton` optimistic pattern — lift the like state so both the tap button and the highlight gesture reflect the same count (or, simplest: call the action and let the existing `revalidatePath` refresh; the tap `LikeButton` remains the source of truth for count display). Do NOT duplicate the mutation — both paths call `setStoryLikeAction`.

- [ ] **Step 5: `.treasure` style** in `StoryReadBody.module.css`:
```css
.treasure {
  background-image: linear-gradient(var(--highlighter), var(--highlighter));
  background-repeat: no-repeat; background-position: 0 82%; background-size: 100% 40%;
  border-radius: 2px;
}
:global([data-tone="solemn"]) .treasure { background-image: none; text-decoration: underline; }
```
(Under solemn, the treasure still registers the Like but shows a quiet underline instead of the candy swipe.)

- [ ] **Step 6: Run** — `pnpm --filter @chronicle/web exec vitest run app/hub/stories/[id]/useTreasureHighlight.test.ts` → PASS. Then `typecheck && build`.
- [ ] **Step 7: Commit** — `feat(story): highlight-to-treasure drag gesture over the existing Like path (tap fallback intact)`. **Push the branch.**

---

## Task 9: Phase 2 preflight

- [ ] **Step 1: Full CI-equivalent preflight** (lint is a no-op here, keep it for parity):
```
pnpm -r lint && pnpm -r typecheck && pnpm -r test \
  && pnpm --filter @chronicle/web build \
  && pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle
```
Expected: all green; **no drizzle drift** (this phase touches no DB — if `db:generate` dirties `packages/db/drizzle`, something is wrong).

- [ ] **Step 2:** If green, the main agent pushes the final commit to `feat/playful-skin-system` (updates PR #101 + preview). Do NOT merge; do NOT deploy to prod. If the user later wants Phase 2 as its own PR, split then.

---

## Self-Review (against the spec + kickoff)

- **Migrate 4 flagship surfaces inline → CSS Modules** → Tasks 2 (hub shell), 3 (nav), 4 (card), 5 (feed chrome), 6 (detail + capture). ✓
- **Structural signatures: photo-forward, tilt, tape, sticker tags, highlighter, feature variant** → Task 4 (`StoryCard.module.css`). ✓
- **Bright `#EF7A54` decorative-only** → Task 1 `--deco-coral`/`--tape-bg`/`--tilt-shadow` (fills, no text); text/buttons keep AA coral; `contrast.test.ts` extended not weakened. ✓ (matches locked decision 1)
- **`data-tone="solemn"` structural + palette dial-down, wired to capture/confirmations** → Task 1 (guard + token mute), Task 6 (set on capture subtree). Per-subtree attribute, not a preference. ✓ (decision 4) — *approval/erasure confirmations wiring is best-effort: capture is done in Task 6; extend to erasure/approval dialogs if they exist on the migrated surfaces, else fast-follow (spec §4.5 "best-effort this pass").*
- **hold-to-remember (progressive enhancement, tap + reduce-motion fallbacks, solemn-aware)** → Task 7. ✓ (decision 3 order)
- **highlight-to-treasure (pure client over existing Like, no data model)** → Task 8. ✓ (decision 2)
- **Nav de-clutter → Stories · Album · Family · Questions + "＋ Tell a story"** → Task 3. ✓
- **Per-surface a11y: AA contrast (extend `contrast.test.ts`), focus-visible, touch targets, rem font-scale** → Task 1 (contrast), every module carries `:focus-visible` + `--touch-min` + rem/token sizes. ✓
- **Single-source tokens (no hardcoded hex/px in components)** → convention doc Task 2 rule 3; signatures read tokens. ✓
- **Motion + solemn guards on every signature** → each module pairs `:global(:root[data-skin])` rules with `:global(:root[data-reduce-motion="on"])`/`:global([data-tone="solemn"])` suppressors. ✓
- **KindredStoryCard orphan** → surfaced up-front; Task 4 retargets to the rendered `FeedCard` and deletes the dead file. ✓
- **No DB migration** → Task 9 asserts no drizzle drift. ✓
- **Placeholder scan:** interaction/foundation tasks carry full code; migration tasks give complete module CSS + exact class inventories + the non-obvious signature rules (the mechanical 1:1 inline→class ports are fully enumerated by class name with token-identical values). No "TBD"/"add error handling"/"similar to Task N" left unresolved. ✓
- **Type/name consistency:** `StoryItem`, `setStoryLikeAction(storyId, liked)`, `LikeState`, `KindredVoiceButton` `holdToRecord`/`onHoldStart`/`onHoldEnd`/`waveform`, `useAudioLevel(stream, enabled)`, `useTreasureHighlight(ref, enabled, onTreasure)`, `Tone`/`data-tone`, `--deco-coral`/`--sticker-*-bg`/`--sticker-*-ink`/`--tape-bg`/`--highlighter` used consistently across tasks. ✓
