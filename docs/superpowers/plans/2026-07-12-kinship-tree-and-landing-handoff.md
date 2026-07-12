# Handoff — Land the kinship stack (Track A) + build the visual tree (Track B), in parallel

Date: 2026-07-12
For: a fresh Claude Code session (agent-team orchestration)
Repo: `boosey/familyapp` (pnpm workspaces monorepo, TS end-to-end, Node ≥20)

## 0. Your mission in one paragraph

Two tracks, run **concurrently** with an agent team. **Track A** = reconcile and land the
already-built kinship stack to `master` (+ Neon migrate). **Track B** = build the read-first visual
family tree at `/hub/tree` per the approved spec. They share code, so there is **one blocking
foundation stage first** (merge + shared contracts), then a **wide parallel fan-out**. Do NOT merge
to `master` or migrate Neon yourself — those are human-gated (see §6).

## 1. Ground truth (verify before acting — `git worktree list`, `git log`)

- `master` = `d2636e8` — **no kinship work is on master.** Everything below is unmerged.
- Stacked worktrees (each branch stacked on the previous):
  - `#30` person provenance — `worktree-issue-30-person-provenance` @ `49979eb` (migration 0008)
  - `#31` kinship edge model — `worktree-issue-31-kinship-edge-model` @ **`2ec556f`** (migration 0009; this tip also holds the **tree-viz spec**)
  - `#32` add/view relative — `worktree-issue-32-add-view-relative` @ `c73768a`
  - `#33/#34` steward + subject-hide — `worktree-issue-33-steward-hide` @ `8183a93` (= #31+#32+#33+#34; **no new migration**, tables are in 0009)
  - `#35` story-subjects — `worktree-issue-35-story-subjects` @ `144bb14` (= #32+#35; migration 0010)
- **`#33` and `#35` both fork from `#32` (`c73768a`).** Their only overlapping files are additive:
  `apps/web/app/_copy/hub.ts` and `packages/core/src/index.ts`. Everything else is disjoint. Migration
  chain is linear: 0008 (#30) → 0009 (#31) → 0010 (#35).
- **The approved spec:** `docs/superpowers/specs/2026-07-12-kinship-tree-viz-design.md` (committed at
  `2ec556f` on the `#31` branch). Read it fully — it is the contract for Track B. Key points: generational,
  you-anchored + re-centerable, tap → read-only panel, monogram nodes, **bounded + incremental
  server-fed fetch that scales to large families**, hand-rolled pure layout + SVG, adds
  `persons.deathYear`/`deathDate` + create-time capture.
- ADR anchor: `docs/adr/0016-kinship-is-a-steward-governed-per-family-tree.md` (the tree renderer is its
  named deferred seam).

## 2. Orchestration model (agent teams)

Use the `Agent` tool. Batch independent agents into a single message so they run concurrently. Give
**each parallel file-mutating agent `isolation: "worktree"`**. Follow the repo's subagent-driven
workflow: a **builder** writes a task, then a **fresh cold `code-reviewer`** agent reviews it, and the
builder iterates until clean — spin up a *new* reviewer each round. Coordinate shared contracts in a
**blocking first step** (Shared-Contracts-First) before any parallel implementation.

## 3. STAGE 0 — Foundation + shared contracts (BLOCKING; do this on the main thread, no fan-out yet)

Produces the single integration base that both tracks build on.

1. **Create integration branch/worktree** `worktree-kinship-integration` off `worktree-issue-33-steward-hide`
   (`8183a93`).
2. **Merge `worktree-issue-35-story-subjects` (`144bb14`) into it.** Resolve the two additive conflicts by
   **keeping both sides**: in `_copy/hub.ts` keep both the `hub.subjects.*` (from #35) and the kin/governance
   keys; in `packages/core/src/index.ts` keep both export groups. No migration conflict (0010 is only on #35).
3. **Bring the spec onto this branch:** `git cherry-pick 2ec556f` (doc-only).
4. **Green the merge:** `pnpm -r typecheck && pnpm -r test` (the migration-drift guard must pass).
5. **Land the Track-B shared contracts as one commit** so parallel B agents compile against them:
   - **Schema:** add `deathYear` (integer, nullable) + `deathDate` (date, nullable) to `persons` in
     `packages/db/src/schema.ts`; run `pnpm --filter @chronicle/db db:generate` → emits **migration 0011**
     (additive columns, no invariant to hand-carry). Confirm drift-guard green.
   - **Types (exported):** `KinshipTreeData`, `TreeNode`, `TreeWindow`, `ExpansionState`, `TreeLayout`
     (+ `PlacedNode`/`PlacedUnion`/`Connector`/`Affordance`) exactly as in spec §5/§6; extend
     `AddRelativeInput` with `deathYear?`/`deathDate?`.
   - **Signature stubs** (throwing `NOT_IMPLEMENTED`): `resolveKinshipTree` in `kinship-repository.ts`
     (+ export in `index.ts`); `computeTreeLayout` in `apps/web/app/hub/tree/layout.ts`.
   - **Pre-place the shared-file edits** that B-capture and B-ui would otherwise collide on: add the
     `hub.tree.*` and death-year copy-key placeholders to `_copy/hub.ts`, and the "Family tree" cross-link
     stub on `/hub/kin/page.tsx`. This keeps those two files off the parallel critical path.
   - Commit. **Record this commit hash** — it is the base for every Stage-1 agent.

## 4. STAGE 1 — Parallel fan-out (spawn concurrently, worktree-isolated, each with its own cold reviewer)

### Track A — finish landing (runs concurrently with all of Track B)
- **A-review:** fresh cold review of the *merged* integration (the merge is a new artifact even though each
  branch was reviewed before). Fix findings.
- **A-release-prep:** verify migrations 0008→0011 apply cleanly to a fresh PGlite and dry-run against Neon;
  write the release runbook + open the PR(s). **STOP before** merging to `master` / running `db:migrate` —
  those are §6 human gates. Commits must be authored by **boosey** (Vercel git-author gate).

### Track B — build the tree (parallel builders; file ownership keeps them non-colliding)
- **B-core** → `packages/core/src/kinship-repository.ts` (+ `index.ts` export) + PGlite tests. Implement
  `resolveKinshipTree`: bounded/incremental windowed fetch over `resolveKinshipProjection`, `hasHiddenParents/
  Children` boundary flags, hydration, `relationToRoot` via `deriveKin`. Tests: membership gate, subject-hide
  suppression, anon rejection, root defaulting/invalid-root fallback, **windowing + large-tree fixture**, merge-
  without-dup on follow-up read.
- **B-layout** → `apps/web/app/hub/tree/layout.ts` (+ `layout.test.ts`). Implement `computeTreeLayout` pure
  fn. Most independent (types only). Tests: generation assignment, partner unions, child centering, bounded
  windowing + expansion reveal, caret-affordance logic, anonymous-bridge labeling, determinism, shared-
  grandparent DAG, multiple partners, root-only.
- **B-capture** → `apps/web/app/hub/kin/{actions.ts,page.tsx}` + `packages/core/src/kinship-write.ts` + core
  test. Add optional "Year of death" field (shown when life status = deceased) threaded through
  `addRelativeAction` → `addRelative` → `deathYear`/`deathDate`. **Companion regression test** (bugfix/feature
  discipline).
- **B-ui** → `apps/web/app/hub/tree/*` (except `layout.ts`) + `_copy/hub.ts` (`hub.tree.*` values). `TreeCanvas`
  (state, SVG render, drag-pan, Fit, **fetch-on-expand** via a server action wrapping `resolveKinshipTree`,
  merge+dedup), `PersonNode` (4 states, monogram, **medium-weight chevron carets**), `PersonPanel` (read-only:
  Stories about them / Center tree here / Manage kin), `page.tsx` (`?scope=`/`?root=` resolution, empty/error
  states per spec §9). Consume the Stage-0 stubs; unblocks fully once B-core + B-layout land.

**Collision control:** the only shared files are `_copy/hub.ts` and `index.ts` and `/hub/kin/page.tsx` — Stage 0
pre-seeds their structural edits, so builders only fill in disjoint regions. If two agents must touch the same
file region, serialize those two via `SendMessage` rather than racing.

## 5. STAGE 2 — Integrate + verify (main thread)

- Land all Track-B branches onto `worktree-kinship-integration`; full `pnpm -r typecheck && pnpm -r test &&
  pnpm -r lint` green.
- **Run the app** and verify behavior (use the `run` / verification skills): `/hub/tree` renders you-anchored;
  expand carets reveal parents/children (in-window instantly, boundary via fetch); pan + Fit; tap → panel; a
  deceased relative shows a real `YYYY–YYYY` span; re-center via `?root=`.
- Final fresh cold review of the whole Track-B surface. Update `docs/PLAN.md`/`docs/PROGRESS.md`; flip the
  ADR-0016 tree-renderer seam to Implemented.

## 6. STAGE 3 — Release (HUMAN-GATED — prepare, don't execute)

All of the following are HITL and must not be done by an agent:
- Merging Track A (the kinship stack) and Track B to `master`.
- Vercel deploy + `db:migrate` applying migrations 0008–0011 to prod Neon + the parity gate.
- Vercel **git-author gate**: only commits authored by `boosey` (`boosey.boudreaux@gmail.com`) deploy.
Prepare PRs, runbook, and a rollback candidate; hand to the human for sign-off.

## 7. Guardrails (do not weaken)

- The **single front door**: content reads/writes go through `@chronicle/core`; the tree is kinship metadata,
  not content — `resolveKinshipTree` lives in the already-allowlisted `kinship-repository.ts`; the only hop to
  content ("Stories about them") uses the SEE-gated `listStoriesAboutPerson`. The architecture tests must stay
  green.
- Append-only ledgers, vendor-seam rules, `noUncheckedIndexedAccess`/ESM conventions — unchanged.
- Keep the layout function **pure and dependency-free** (Approach A). No graph-layout library, no React Flow.
- Do not design out large families — bounded/incremental fetch is load-bearing (spec §5/§7/§11).

## 8. Self-contained kickoff prompt (paste into the fresh session)

> Read `docs/superpowers/plans/2026-07-12-kinship-tree-and-landing-handoff.md` and
> `docs/superpowers/specs/2026-07-12-kinship-tree-viz-design.md` in full. Then execute Track A and Track B
> concurrently using an agent team: first do the blocking Stage-0 foundation (merge #33+#35 into
> `worktree-kinship-integration`, cherry-pick the spec, add the death-field schema + migration 0011, and land
> the shared contract types/stubs), then fan out Stage-1 builders in parallel (worktree-isolated, each with a
> fresh cold code-reviewer): Track-A review+release-prep alongside Track-B B-core / B-layout / B-capture / B-ui.
> Integrate and verify in Stage 2. STOP at Stage 3 — merging to master and Neon migrate are human-gated.
> Verify ground-truth commits with `git worktree list` before acting.
