# Playful Redesign — Phase 2 Kickoff (fresh-session handoff)

Self-contained brief to start Phase 2 in a new session. Read this + the two docs it references, then go.

## The product (why dignity matters)
Family Chronicle / "Tell Me Again" (live: tellmeagain.app) — an intergenerational tool where families capture relatives' memories, often by voice, often at emotionally heavy moments (a dying parent, a grandparent's history). Audience includes **older narrators**. So: **WCAG AA contrast is a real requirement, not gold-plating**, and "playful" must never become "flippant."

## The redesign, so far
- **Direction (approved):** "Playful & Warm" — scrapbook feel: warm multi-color, rounded humanist type (Baloo 2 / Nunito), taped/tilted photos, sticker tags, highlighter underline.
- **Architecture (approved):** a **bounded skin system** — `data-skin` token blocks riding the existing ADR-0020 preferences registry. NOT a per-UI plugin registry (rejected as velocity-death).
- **Phase 1 = DONE, in review as PR #101** (branch `feat/playful-skin-system`, worktree `.claude/worktrees/playful-skin`, preview `https://familyapp-git-feat-playful-skin-system-booseys-projects.vercel.app`). It shipped the skin infra + a **token-only** app-wide re-skin (no component structural changes), two skins (`playful` default + `heirloom`), a reduce-motion toggle, a skin picker, and guard tests (skin-contract, reduce-motion, WCAG-contrast). GitHub CI green.

**Read before starting:**
- Spec: `docs/superpowers/specs/2026-07-17-playful-skin-system-design.md`
- Plan: `docs/superpowers/plans/2026-07-17-playful-skin-system.md` (Phase 2 is outlined at the bottom)

## Phase 2 scope (the approved flagship set)
Migrate these surfaces from inline `style={{}}` to **CSS Modules** (Phase 1 left all styling inline; inline styles out-specify `[data-skin]` overrides, so structural signatures require this migration) and add Playful's structural signatures. Each surface is independent + shippable:
1. **Hub feed** — `apps/web/app/hub/page.tsx` shell + **nav de-clutter** (today: 8 tabs + Feed/Timeline/Search + Masonry/Column; target: **Stories · Album · Family · Questions** + a prominent **"＋ Tell a story"**, view-options relocated to a secondary control), `hub/tabs/StoriesTab.tsx`, `hub/tabs/StoryBrowse.tsx`. Add a photo-forward **featured** story + grid.
2. **Story card** — `apps/web/app/_kindred/KindredStoryCard.tsx` → CSS Module: photo-forward, odd/even tilt, tape pseudo-element, sticker/candy tags, highlighter title, `feature` variant.
3. **Story detail** — `apps/web/app/hub/stories/[id]/StoryReadBody.tsx` + **novel interaction: highlight-to-treasure** (drag to highlight a line as a reaction, over the existing Like path).
4. **Capture / record flow** — `apps/web/app/s/[token]/page.tsx`, `hub/tell/*`, `hub/answer/[askId]/*` + **novel interaction: hold-to-remember** (press-and-hold record, breathing waveform, tap-to-toggle fallback). `data-tone="solemn"` aware.

**Cross-cutting:**
- Establish the CSS-Modules convention in the first migrated file; reuse it.
- `data-tone="solemn"` structural + palette dial-down (suppress tilt/tape/bounce/highlighter, mute palette, keep warmth); wire it to erasure/approval/consent confirmations.
- **Reintroduce the bright coral `#EF7A54`** as a DECORATIVE fill (tape/tilt/sticker backgrounds) where it carries no small text — this is where it's safe.
- Novel interactions ship as **progressive enhancement over a working plain fallback**, gated by reduce-motion + solemn.
- Per-surface a11y: AA contrast (extend `apps/web/app/_skins/contrast.test.ts` for any new color pair), visible `:focus-visible`, touch targets, font-scale (rem) intact.

## Hard constraints & lessons already paid for
- **The accent-family rule (WCAG AA):** `--accent` = button background (white text). `--accent-strong` = the DARK variant, used as TEXT in ~40 places AND as button-hover background — it MUST stay dark. A single shared `--accent-on` can't be legible on both a light and a dark coral, so **do not** make coral text-bearing bright. `contrast.test.ts` guards `--accent-on`/`--accent`, `--accent-on`/`--accent-strong`, and `--accent-strong`/surfaces — extend it, don't weaken it.
- **Single-source tokens (CLAUDE.md):** skin values live only in `_skins/*.css` / `tokens.css`; no hardcoded hex/px in components.
- **Motion tokens + guards:** all structural motion gated `:not([data-reduce-motion="on"])` and dialed down under `[data-tone="solemn"]`.
- **Skin model:** `data-skin` = design language; `data-theme` = palette sub-variant (heirloom's archive/hearth). Don't put palette under `[data-skin="heirloom"]` (would out-specify themes) — see the doc comment in `tokens.css`.

## Workflow (this repo mandates it — CLAUDE.md)
- Work in a **git worktree**; `pnpm install` in it first (node_modules isn't shared). Sequential builder→reviewer subagents SHARE the worktree (do NOT give them `isolation: "worktree"`).
- **Subagent build/review:** a builder writes code test-first; then a **fresh COLD reviewer** each round; iterate to clean. (Two rounds caught real AA bugs in Phase 1 — keep this rigor.)
- **GIT RULES for every subagent (put in every prompt):** commit only on the current branch; author `boosey <boosey.boudreaux@gmail.com>` (Vercel git-author gate); NEVER `checkout`/`switch`/`reset`/`merge`/`rebase`/`push`/`branch -D`, never touch `master`, never open a PR. Main agent owns branch/push/PR.
- **Preflight before pushing** (lint is a no-op here): `pnpm -r typecheck && pnpm -r test && pnpm --filter @chronicle/web build && pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle`.
- **Open a PR for human review; do NOT merge; do NOT deploy.** Preview deploys are auto-created by Vercel on push (safe here — no DB migration; but if Phase 2 ever adds a migration, note that Vercel PREVIEW `db:migrate` runs against PROD Neon).

## Decisions to confirm at the START of Phase 2
1. **Branch base:** if PR #101 has merged, branch Phase 2 off `master`; if not, **stack** on `feat/playful-skin-system`. Ask the user.
2. **Coral hue final call:** keep AA-safe `#CC4A22` / go brighter with dark-ink text / rely on decorative bright `#EF7A54` in Phase 2. (User was shown the live preview.)
3. **highlight-to-treasure data model:** does it touch the Like/consent model (a richer reaction) or stay a pure client enhancement? Resolve before building it.
4. **Which novel interaction first** (hold-to-remember is lower-risk — pure client over the existing capture path).

## First moves for the new session
1. Read the spec + plan (above). Confirm #101 merge status + branch base with the user.
2. Invoke **superpowers:writing-plans** to turn the Phase 2 outline into a detailed, TDD, per-surface plan (consider one PR per surface, or a small stack).
3. Set up the worktree, `pnpm install`, then subagent-driven build with cold reviews, per the workflow above.
