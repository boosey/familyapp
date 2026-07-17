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
- **Push to `feat/playful-skin-system`** — this updates PR #101 and redeploys its Vercel preview (how the user watches progress). Do **NOT** merge; do **NOT** deploy to prod. Safe here — no DB migration; but if Phase 2 ever adds one, note that Vercel PREVIEW `db:migrate` runs against PROD Neon, so keep migrations idempotent.

## Branch base — DECIDED (do not re-ask)
Phase 2 **continues on the existing `feat/playful-skin-system` branch** (worktree `.claude/worktrees/playful-skin`). Do **NOT** merge PR #101 first, and do **NOT** branch off master. The user wants the Vercel **preview build to keep running on this branch line** so they can watch the re-skin fill in surface by surface — every push to the branch redeploys `https://familyapp-git-feat-playful-skin-system-booseys-projects.vercel.app`. PR #101 simply grows to include Phase 2. (Splitting into separate PRs can happen later if the user asks.) When it eventually merges, master may have advanced — rebase/merge master in and re-run guards then, not now.

## Decisions to confirm at the START of Phase 2
1. **Coral hue final call:** keep AA-safe `#CC4A22` / go brighter with dark-ink text / rely on decorative bright `#EF7A54` in Phase 2. (User was shown the live preview.)
2. **highlight-to-treasure data model:** does it touch the Like/consent model (a richer reaction) or stay a pure client enhancement? Resolve before building it.
3. **Which novel interaction first** (hold-to-remember is lower-risk — pure client over the existing capture path).

## First moves for the new session
1. Read the spec + plan (above). **Branch base is already decided** — continue on `feat/playful-skin-system`. Re-enter the existing worktree `.claude/worktrees/playful-skin` (`pnpm install` there if `node_modules` is missing). Do not merge #101; do not branch off master.
2. Confirm the three open decisions above (coral hue, highlight-to-treasure data model, first interaction) with the user.
3. Invoke **superpowers:writing-plans** to turn the Phase 2 outline into a detailed, TDD, per-surface plan (build surface by surface so each push gives the user a preview to watch).
4. Subagent-driven build with cold reviews, per the workflow above. Push each surface to the branch as it goes green so the preview updates.
