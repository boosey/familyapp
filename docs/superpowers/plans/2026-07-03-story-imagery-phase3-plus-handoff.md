# Handoff — Implement the rest of ADR-0009 Story Imagery (Phase 3 → then 4 → 5)

## Your job
Finish **Phase 3** (Story-from-a-photo + Ask-targets-photo), then continue to **Phase 4** (suggestion
ranker) and **Phase 5** (Google Picker import). Phases 1a/1b/2 are DONE; Phase 3's contract is written
and the build was about to start when the session was handed off.

## Where the work lives
- **Worktree:** `.claude/worktrees/story-imagery-phase2plus` (branch `worktree-story-imagery-phase2plus`).
  Run ALL commands from there. Deps installed.
- This branch is based on local `master` HEAD (`835bffb`, the album-fixes merge) and includes Phase 2.
  **Neither `master` nor this branch is pushed to origin.** Do not push unless asked.
- **Git identity is already `boosey.boudreaux@gmail.com`** (repo-local) — required by the Vercel deploy
  gate. Keep it. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## Authoritative specs & contracts (READ THESE — do not duplicate them)
- `docs/adr/0009-story-imagery-album-topology.md` — the spec. Phase 3 = the "Subject" paragraph
  (lines ~67-72) + authz consequence (95-98).
- `docs/PLAN.md` "STORY IMAGERY (photos)" section (~line 242): Phase 3 ~273, Phase 4 ~280, Phase 5 ~286.
- **Phase 3 shared contract (COMPLETE — this is your build spec, start here):**
  `docs/superpowers/plans/2026-07-03-story-imagery-phase3-contract.md`. It has LOCKED design decisions,
  the exact schema, seam signatures, file:line anchors, and the two-slice split (Slice A = DB+core,
  Slice B = web).
- Phase 2's shape (for style/idioms): read the committed diff — `git show 443714d`.
- NOTE: earlier per-phase contracts (phase2, album-fixes) were written to a session-ephemeral scratchpad
  and are NOT in the repo; use the committed code as their reference instead.

## Repo working agreement (from CLAUDE.md — non-negotiable)
- **Subagent-driven build+review loop:** a coding sub-agent writes each slice; then spawn a SEPARATE,
  FRESH, cold adversarial reviewer (`feature-dev:code-reviewer` agent type). The coding agent consumes
  the review and iterates. New cold reviewer each round. Main agent orchestrates only.
- **Shared Contracts First:** land schema/types/seam signatures before fanning out. Slice A (core) IS the
  contract Slice B (web) builds against — so build A → review → fix → THEN B.
- **The single front door:** all Story/Media/photo content reads/writes go through `@chronicle/core`;
  guarded tables live behind `@chronicle/db/content`; `packages/core/test/architecture.test.ts` enforces
  an allowlist + a `db.query.*` FORBIDDEN regex + a canary literal. Adding a guarded read/write path
  means editing that test deliberately.
- After a bug fix, write a companion regression test. TS strict/ESM/`verbatimModuleSyntax`.
- Single-schema policy: NO migrations — edit `schema.ts` → `pnpm --filter @chronicle/db db:generate` →
  the reseed workflow applies `schema.sql` + `invariants.sql`. The db test suite checks schema parity.

## Adversarial posture (this matters — both prior slices shipped a real authz bug the cold reviewer caught)
The photo-visibility model is subtle. Prior slices each had an over-grant a fresh reviewer caught — e.g.
Phase 2 Slice A: `attachPhotoToStory` let anyone self-grant read access to any photo by UUID (attach to
own private draft → read back via the new union rule); fixed with an album-access gate. Be genuinely
adversarial in reviews. For Phase 3 specifically: can a subject-photo/ask-photo be used to see a photo the
actor shouldn't? The contract's consolidated `assertPersonCanAccessAlbumPhoto` gate (Slice A §2) is the
defense — make sure creation AND ask-targeting both go through it.

## Exactly what to do next (Phase 3)
1. **Dispatch Phase 3 · Slice A (DB + core)** to a coding sub-agent, brief = contract Slice A §1–§7:
   `stories.subject_photo_id` (nullable FK, no cascade) + OPEN `ask_subject_photos` table; consolidate the
   album-access gate into an exported `assertPersonCanAccessAlbumPhoto` in `album-repository.ts`; refactor
   `attachPhotoToStory` to expose a tx-aware `attachPhotoToStoryTx`; thread `subjectPhotoId?` through
   `createTextDraft` / `persistRecordingAndCreateDraft` (atomic first-cover insert in the same tx) and
   through `capture.ts` ingest inputs; add `subjectPhotoIds?` to `createAsk` + a `listAskSubjectPhotos`
   read; PGlite tests. Interviewer package is NOT touched (opener = caption→`promptQuestion` at web layer).
   Verify: `pnpm --filter @chronicle/db test`, `pnpm --filter @chronicle/core test`, `pnpm -r typecheck`.
2. **Fresh cold review** of Slice A (the gate covers BOTH story-creation and ask-targeting; the atomic
   cover insert; `ask_subject_photos` being OPEN doesn't leak bytes; architecture test still green). Fix
   findings; re-verify.
3. **Dispatch Phase 3 · Slice B (web)** against the locked Slice A signatures: "Tell the story of this
   photo" button in `AlbumPhotoViewer.tsx` → tell flow carrying `subjectPhotoId` + caption-derived
   `promptQuestion` → `composeStoryAction`; answer→story carry-forward (read the ask's subject photos, set
   the new story's subject + attach the rest); Ask-attach-photo picker in `AskTab.tsx`; display the ask's
   subject photo(s) on the answer surface. Web tests. Use `KindredButton` + REAL design tokens (the
   album-fixes work fixed many phantom-token bugs — do not reintroduce them).
4. **Fresh cold review** of Slice B (IDOR on any new server actions — every mutation must re-resolve auth
   server-side and verify ownership/authority before calling core; gallery/subject reads gated).
5. **Full combined verification:** `pnpm -r typecheck` + core + db + web test suites.
6. **Commit Phase 3** on the worktree branch (the user's standing preference this session was "commit P2,
   start P3" — commit each phase as a checkpoint). `feat(imagery): Phase 3 …` mirroring `git show 443714d`.
7. **Checkpoint with the user** before Phase 4, unless they've said run straight through.

## After Phase 3
- **Phase 4 — suggestion + photo nudge** (`docs/PLAN.md` ~280): rank a draft's candidate album photos by
  caption-text match ∪ EXIF-date proximity to the story's `eraYear`; silent picker ranking + an editor
  "photo nudge". Deterministic/heuristic first; reserve a `PhotoUnderstanding` vendor-seam INTERFACE
  (mock only) in `@chronicle/pipeline` (vendor-seam architecture-test rule: SDKs only in adapters). EXIF
  (`family_photos.exif_captured_at`) is already captured but unused — this consumes it.
- **Phase 5 — Google Photos Picker import** (`docs/PLAN.md` ~286): a new adapter-isolated
  `@chronicle/photos-google` package; ephemeral picker session, NO stored refresh token, copy selected
  bytes → `family_photos` with `source='google_picker'` (enum value already exists). Depends only on Phase
  1, so it can slot in independently. Vendor-seam rule: SDK only in the adapter file.
- Write a fresh shared contract per phase (in `docs/superpowers/plans/`) before building.

## Verification quick-reference
- `pnpm -r typecheck` (all 13 projects) · `pnpm -r test` (heavy) or per-package:
  `pnpm --filter @chronicle/core test` (~295 tests) · `pnpm --filter @chronicle/db test` (67) ·
  `pnpm --filter @chronicle/web test` (400) · root lint `pnpm exec oxlint <files>` (no per-pkg lint).
- Prove regression tests have teeth (fail-before/pass-after) for any bug fix.

## Current state snapshot
- Phase 2 committed at `443714d`; everything green there. Main repo checkout (OUTSIDE the worktree) is
  clean on `master` — a prior subagent once edited it by mistake, so DOUBLE-CHECK
  `git -C <repo-root> status` stays clean if a web agent misbehaves.
- Two open GitHub follow-up issues from the album-fixes work (NOT part of Phase 3): #20 (direct-to-storage
  uploads — Vercel 4.5MB body limit) and #21 (upload hardening). Ignore unless the user asks.

## Suggested skills for the next session
- `superpowers:using-git-worktrees` — you're already in the worktree; confirm isolation (Step 0), don't
  create a new one.
- `superpowers:subagent-driven-development` + `superpowers:requesting-code-review` /
  `superpowers:receiving-code-review` — the build+cold-review loop this repo mandates.
- `superpowers:verification-before-completion` — run the commands, show output, before claiming green.
- Context7 MCP for any drizzle-orm / Next.js API questions (per the user's global rule).
