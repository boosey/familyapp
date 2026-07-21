# Playful Redesign — Continuation Handoff (2026-07-17, evening)

Self-contained handoff for resuming the "Playful & warm" redesign of Family Chronicle after a context clear.

## Where things stand (one paragraph)
The redesign direction is **locked and approved by the owner**: "Playful & warm" (bright coral, orange-leaning, crisp humanist sans, scrapbook-style varied card layouts). All of it is **committed and pushed** to `feat/playful-skin-system` (PR #101) — BUT **none of it is visible on the Vercel preview** because every Preview build is failing on a missing env var (see BLOCKER). The owner iterated the design on a published mockup artifact (not the live app) because the live preview was stale. Immediate job: **unblock the Preview build**, then verify the design actually renders.

## Environment
- Worktree: `C:\Users\boose\projects\familyapp\.claude\worktrees\playful-skin` on branch `feat/playful-skin-system`. Node/pnpm monorepo. Do NOT branch off master; keep pushing to this branch to rebuild the Vercel preview.
- Preview URL (branch alias): `https://familyapp-git-feat-playful-skin-system-booseys-projects.vercel.app` (`/hub` is behind sign-in; the preview uses the **dev** Clerk `joint-turkey-89.clerk.accounts.dev` + a non-prod DB, so the owner's prod steward identity does NOT exist there — the "John" test account is only partially onboarded; this is expected, not a bug).
- **Approved design mockup (persistent):** artifact `https://claude.ai/code/artifact/7fe0300b-500b-4c57-a1f4-39e3af8ed777` (opens on "Playful & warm"; switcher compares all four directions). It shows: gradient "＋ Tell a story" CTA, crisp bold headings, family eyebrow, and the **staggered masonry with varied card layouts** (photo-left, text-wrap, multi-photo collage, text-only, photo-top). The mockup HTML source lived in session scratchpads that are cleared with context — but the **implemented values now live in the committed code** (`apps/web/app/_skins/playful.css`, `apps/web/app/hub/tabs/StoryCard.module.css`, `story-layout.ts`), which is the source of truth going forward.

## ⚠️ IMMEDIATE BLOCKER — Vercel Preview builds fail (fix this first)
The Vercel build command (`apps/web/vercel.json`) is:
`node scripts/check-env.mjs && pnpm --filter @chronicle/db db:migrate && pnpm --filter @chronicle/db db:check-parity && next build`.
GitHub CI only runs `next build`, so **GitHub CI is fully green** but **Vercel fails at step 1**: `check-env.mjs` enforces on ANY Vercel build (`VERCEL` set) without distinguishing Preview vs Production, and **`INNGEST_EVENT_KEY` is missing on the Preview environment** (it was deliberately unshared from Preview per the earlier "Inngest hijack" cure; `INNGEST_SIGNING_KEY` IS still set on Preview). So every Preview deploy of this branch has failed since commit `2c7ac8b` — the owner's coral/font/layout pushes never deployed.

Confirmed via the Vercel MCP build log for `dpl_6iLVQXgpH3o8LetRDYWKPXxtKZFo` (team `booseys-projects`): `✗ missing required production env var(s): INNGEST_EVENT_KEY`.

**Decision the owner was about to make (they were leaning Option A):**
- **Option A (recommended, code fix):** make `apps/web/scripts/check-env.mjs` environment-aware — treat the two `INNGEST_*` keys as **required in Production, warn-only in Preview** (gate on `VERCEL_ENV === "preview"`). Production's guarantee is unchanged; Preview stops hard-failing on the key that's intentionally off Preview. Update `apps/web/__tests__/check-env.test.ts`. Downside: the transcribe→render pipeline won't run on the preview (fine for UI review). **This is the fastest unblock and does not require handling any secret.**
- **Option B:** owner sets a *separate* Preview `INNGEST_EVENT_KEY` in Vercel (an agent must NOT enter secrets; reusing prod's key reintroduces the hijack).

**Next action:** get the owner's go-ahead for Option A, implement it (with test), push, then confirm the Preview build goes green via the Vercel MCP (`get_deployment_build_logs` / `list_deployments`, team `booseys-projects`). The Vercel MCP is authorized this session — re-auth may be needed after context clear (`mcp__plugin_vercel_vercel__authenticate`).

## What's committed on the branch (all pushed; local HEAD == origin)
Newest first:
- `a10fb02` fix(hub): restore "Tell a story" heading on the invite card — **NOT made by this agent** (a concurrent session/agent is also committing here — see COORDINATION). It reverts the invite-card heading toward "Tell a story"; reconcile against the mockup's "Something you want to remember?" heading with the owner.
- `effef40` feat(hub): varied editorial card layouts (photo-left/wrap/collage/text-only) + Source Sans 3. Adds `story-layout.ts` (`pickStoryLayout` — FNV-1a hash of `item.id` → a layout from the group valid for its photo count: 0→textonly, 1→[top,left,wrap], 2+→[collage,top]; deterministic/stable per story) + `story-layout.test.ts`; StoryCard layout variants + CSS; StoryBrowse passes layout in masonry; Source Sans 3 wired in `layout.tsx` and pointed at `--font-display/ui/read/story` in `playful.css`.
- `2c7ac8b` feat(skins): crisp mockup font + orange-forward accent + gradient CTA. Display font → Segoe/system stack (superseded by Source Sans 3 in effef40); `--accent-strong` #D85F39 → #E0742E (less terracotta); new `--accent-gradient` (coral→amber) on the CTA + invite card.
- `2202d87` feat(hub): heavy headings (800) + family eyebrow ("YOUR FAMILY · N CHRONICLING") + gradient invite card. New `--tell-card-bg` token.
- `7d8bea6` fix(test): drop this-alias in FakeMediaRecorder (CI oxlint gate). **Lesson: CI's lint job runs root `pnpm lint` (oxlint) — `pnpm -r lint` is a no-op. Run `pnpm lint` before pushing.**
- `dcd0c22` fix(capture): hoist hold-to-record hooks above early returns in NarratorRecorder — a **real T7 rules-of-hooks CRASH on every capture**, caught by the T9 full-suite gate; `bd99b4a` repaired 16 stale T7 capture-flow tests.
Earlier: `6c8b7f4`/`ab0a0be` = T8 highlight-to-treasure. Phase 2 (T1–T9) is otherwise complete.

Design tokens are token-driven and reusable (the skin infra is the whole point — reskinning is a token swap). Bright coral `#EF7A54` is a deliberate BRAND choice below WCAG AA; `contrast.test.ts` relaxes the brand-coral pairs to a legibility floor and still guards body prose + solemn fallback.

## Open threads / unfinished business
1. **Vercel Preview blocker (above) — do first.**
2. **Verify the redesign on the preview** once it builds. The John preview account has ONE text-only story ("Great", no photos), so the varied-layout masonry won't show its variety. Offer to **seed a few dev stories with photos** on the preview so the feed variety is actually visible (owner said this would help; not yet done).
3. **COORDINATION — a concurrent session/agent is also committing to `feat/playful-skin-system`** (e.g. `a10fb02`, and mystery preview commits `b2b0844`/`036bd63`/`bce1506` seen in Vercel deploy history). Per memory there are sibling workstreams (redesign proto; phone normalizer). Pull/rebase-aware before committing; reconcile the invite-card heading copy conflict.
4. **Invite-card copy conflict:** the mockup heading is "Something you want to remember?" with a "Tell a story →" action; `a10fb02` restored "Tell a story" as the heading. Confirm which the owner wants.
5. **PR #101 title still says "Phase 1 — token-only re-skin"** but the branch now contains all of Phase 2 + the full redesign. Consider updating the title/body, or splitting the redesign into its own PR (owner's call; do NOT merge to master without sign-off).
6. **Portable font confirmation:** Source Sans 3 chosen as the cross-platform near-match to Segoe UI; owner to confirm it reads right once it deploys.
7. **Cosmetic:** `playful.css` comment near `--accent-strong` still says `#D85F39` but the value is `#E0742E`; fix opportunistically.
8. **Non-blocking follow-ups:** #14 (extract shared TabPills primitive) and #110 (tokenize raw hardcodes in `capture.module.css`). See [[project_playful_phase2_followups]].

## GIT RULES for any subagents
Commit only on this branch/worktree, author `boosey <boosey.boudreaux@gmail.com>`, Co-Authored-By trailer; NEVER checkout/switch/reset/merge/rebase/push/branch -D/amend, never touch master, never open a PR — the main agent owns branch/push/PR. Builder→reviewer subagents SHARE this worktree (no `isolation:worktree`). Repo has NO jest-dom (use `.getAttribute`) and NO per-package web lint script (CI lint = root oxlint `pnpm lint`).

## Related memories
[[project_playful_phase2_complete]] · [[project_playful_phase2_followups]] · [[feedback_full_suite_after_interactive_changes]] · [[project_preview_deploys_migrate_prod]] · [[project_invite_delivery_appbaseurl_inngest_hijack]] · [[project_clerk_prod_domain]]
