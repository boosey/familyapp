# Kinship stack — release runbook (human-gated)

**Date:** 2026-07-12
**Branch carrying the release:** `kin-a-release` (based on the kinship-integration base).
**Author of record:** must be `boosey` — see the git-author gate below, it is a hard blocker.

This runbook lands a large body of previously-unmerged kinship work onto `master` and out to
production (Vercel + prod Neon). It is a **HUMAN checklist**. An agent prepared it; a human executes
it. Do NOT let an automated agent merge to master or run a Neon migration — both are deliberate,
human-confirmed steps.

---

## 0. What is being released

The kinship stack (ADR-0016), currently absent from `master` (`master` = `d2636e8`):

| Unit | What | Migration |
|------|------|-----------|
| #30 | Person provenance (origin `self`/`invitee`/`mention`, flexible/nullable names, `identified`) | **0008** |
| #31 | Kinship edge model + core authorization surface (append-only assertion + subject-hide ledgers) | **0009** |
| #32 | Add & view a relative (`addRelative` write path, `/hub/kin` read view) | — |
| #33 | Steward governance — affirm / deny / correct an edge | — |
| #34 | Subject-hide veto — hide/unhide an edge about you | — |
| #35 | Story-subject tagging (who a story is about, `story_subjects` link table) | **0010** |
| Tree viz | Create-time death-year/date capture + `resolveKinshipTree` core read + pure `computeTreeLayout` layout engine | **0011** |

Migrations **0008 → 0011** are all part of this release. `master` is currently pinned at journal
`0007`; the deploy will advance prod Neon through `0008`, `0009`, `0010`, `0011` in one build.

### Migration-chain verdict (verified 2026-07-12 on `kin-a-release`)

- `packages/db/drizzle/migrations/meta/_journal.json` is a clean linear chain `0000 … 0011`, one
  entry per tag, monotonic `idx`/`when`. No gaps, no duplicates.
- All four kinship migrations are **additive / non-destructive**:
  - **0008** — `CREATE TYPE person_origin`; `ADD COLUMN origin`/`identified` (both with `DEFAULT … NOT
    NULL`, so the backfill is implicit — no separate `UPDATE`); relaxes two existing `NOT NULL`
    constraints (`display_name`, `spoken_name`). No data loss. No trigger/invariant change.
  - **0009** — two new tables (`kinship_assertions`, `kinship_subject_hides`), new enums, FKs,
    indexes, **plus two hand-carried append-only triggers** reusing the pre-existing shared
    `chronicle_forbid_mutation()` guard (drizzle-kit does not model triggers; the trigger DDL is
    hand-carried into the migration and documented inline). Nothing destructive.
  - **0010** — one new table (`story_subjects`) + unique/lookup indexes. Additive.
  - **0011** — `ADD COLUMN death_year integer` + `ADD COLUMN death_date date` on `persons`, both
    nullable. **Additive columns only — no invariant/trigger to hand-carry.** This matches the
    expectation for 0011.
- **Drift guard is green.** `test/migration-drift.test.ts` (3 tests) passes: the snapshot
  (`schema.sql` + `invariants.sql`) and the incremental migration chain fingerprint identically, and
  the comparator's own negative controls fire. This proves 0008–0011 collectively reproduce the
  snapshot the app expects — no silent divergence.
- No evidence of edit-after-apply within this tree: each of 0008/0010 is touched by exactly the one
  PR commit that introduced it; 0009 by its PR commit; 0011 by the integration base commit. (This is
  a within-repo check. The **prod-Neon** landmine class — a migration edited after it already ran on
  Neon — cannot be detected from the repo; see Risks.)
- **Evidence:** `pnpm --filter @chronicle/db test` → **16 files / 82 tests passed**, including the
  drift guard, the append-only ledger guards, and the media/consent invariant suite.
  `pnpm --filter @chronicle/core test` → **43 files / 440 tests passed**, including
  `kinship-tree.test.ts` and the ADR-0011 authorization oracle.

### KNOWN GAP — the visual tree renderer is NOT end-to-end on this branch

As of `kin-a-release` HEAD, the tree **layout engine** (`apps/web/app/hub/tree/tree-layout.ts`,
`computeTreeLayout`) and the **core read** (`resolveKinshipTree` in `packages/core`) exist and are
unit-tested, but there is **no `page.tsx` / `TreeCanvas` at `/hub/tree`** wiring them into a rendered
route — nothing in the app imports `computeTreeLayout` or `resolveKinshipTree` yet. `/hub/tree` will
404 (no `page.tsx`) if deployed as-is.

**Do not tell users "the family tree page is live" based on this branch alone.** Confirm the Track-B
canvas/page work has landed on `kin-a-release` (a `page.tsx` under `apps/web/app/hub/tree/` that calls
`resolveKinshipTree` → `computeTreeLayout` → a client `TreeCanvas`) **before** the pre-merge gate, or
descope the visual tree from this release and ship #30–#35 + death fields only. The `/hub/kin`
add/view-relative surface (#32) and the governance/story-subject surfaces DO ship regardless.

---

## 1. Pre-merge green gate (run on the release branch, before any merge)

From repo root on `kin-a-release`, all three must pass:

```
pnpm -r typecheck && pnpm -r test && pnpm -r lint
```

Do not proceed on any failure. In particular confirm:
- `@chronicle/db` migration-drift guard green (proves the snapshot ≡ chain, so what the deploy applies
  incrementally equals what tests/dev apply wholesale).
- `@chronicle/core` architecture allowlist canaries unchanged (front-door invariant intact — kinship
  is a distinct data category and per ADR-0016 must NOT widen the single content front door).
- The vendor-SDK guard green (no SDK leaked into the IP tree).

If the visual tree page landed, also run `pnpm --filter @chronicle/web build` and confirm `/hub/tree`
compiles as a real route.

**Belt-and-suspenders (recommended, given this project's Neon-drift history):** the drift guard only
proves snapshot ≡ chain *internally* — it does NOT compare against live prod Neon. Before merging,
consider a parity dry-run against an ephemeral Neon **dev** branch (apply 0008–0011 there, run
`db:check-parity` against it) to catch any prod-baseline surprise before it hits the real build. The
build-time parity gate (§3) is still the hard blocker; this is early warning, not a substitute.

## 2. Merge / PR order onto master

The units are a **stack** (each builds on the prior); they are already integrated on `kin-a-release`,
so land the branch as **one** merge — do NOT try to cherry-pick #30–#35 out of order (later units
depend on earlier migrations and core surfaces).

1. Open a PR: `kin-a-release` → `master`.
2. Ensure the PR's merge commit / squash commit author is `boosey <boosey.boudreaux@gmail.com>`
   (git-author gate, §4). If squashing, verify the resulting author.
3. Merge. Because Vercel is git-connected to `master` (root `apps/web`), the merge **triggers a
   production deploy** — treat the merge itself as the go-live action, not a separate step.

There is a single logical migration frontier here (0007 → 0011); one merge = one deploy = one
migrate. Do not merge partway and re-merge.

## 3. Vercel deploy + build-time `db:migrate` + parity gate

On the `master` deploy, Vercel's `buildCommand` runs, in order:
1. `pnpm --filter @chronicle/db db:migrate` — applies pending migrations **0008 → 0011** to prod Neon
   via the drizzle migration chain (tracked in `__drizzle_migrations`; already-applied ones are
   skipped, so this is idempotent). This runs at **build time**, never on the request path.
2. The **schema-parity deploy gate** (`db:check-parity`) — fails the build if prod Neon's live schema
   does not match the expected snapshot. This is the safety net that caught prior Neon drift; a red
   parity gate **must block the release** — do not override it.
3. The Next.js build.

**Before merging**, confirm `DATABASE_URL` in the Vercel project points at the **prod** Neon branch
(not dev) and that the prod branch is currently at journal `0007` (i.e. it has 0001–0007 applied and
is clean). If prod Neon is NOT at 0007, STOP — reconcile the migration state manually first; applying
0008–0011 onto an unexpected baseline is how drift outages happen.

After the deploy finishes, confirm in the Vercel build log that all four migrations reported applied
(or already-applied) and the parity gate passed **before** doing any manual verification.

## 4. Git-author gate (hard blocker — read before merging)

**Vercel BLOCKS the deploy unless the deploy commit's author is `boosey`.** The commit that lands on
`master` must be authored `boosey <boosey.boudreaux@gmail.com>` (repo-local identity), NOT
`alexboudreaux.dev`. If the merge produces a commit authored by anyone else, the deploy will not run
and the migrations will not apply — a silently "stuck" release. Verify the author of the merge/squash
commit on `master` immediately after merging; if wrong, amend the author and re-push before assuming
the deploy is coming.

## 5. Rollback candidate

**Named rollback target: `d2636e8`** (current `master` tip, pre-kinship).

- **App/code rollback:** revert `master` to `d2636e8` (revert the merge commit, or reset+force with a
  human decision) and let Vercel redeploy. The pre-kinship app has no code path that reads the new
  tables, so it runs cleanly against a Neon that has 0008–0011 applied.
- **DB is forward-only.** The migrations are **additive** (new tables, new nullable/defaulted columns,
  new triggers) — reverting the app does **not** require un-applying them, and there is deliberately
  **no down-migration**. Leaving 0008–0011 applied while the app sits at `d2636e8` is safe: the extra
  tables/columns are simply unused. Do NOT hand-drop the kinship tables to "roll back" — that
  re-introduces drift and breaks the parity gate on the next forward deploy.
- If a forward-fix is preferable to a revert (usually it is, given additive migrations), branch from
  `master`, fix, and redeploy rather than reverting the DB.

## 6. Post-deploy verification (production)

Do these against the live prod URL after the deploy + migrate + parity gate all report green:

1. **Migrations applied:** Vercel build log shows 0008–0011 applied; parity gate passed. (Optionally
   confirm `__drizzle_migrations` on prod Neon lists through `0011_equal_raza`.)
2. **`/hub/kin` (add & view a relative — #32):** sign in, add a relative (pick edge type + nature),
   confirm it appears in the kin view. This is the first end-to-end kinship tracer and exercises
   0008 + 0009.
3. **Governance surfaces (#33/#34):** as a Steward, affirm / deny / correct an edge; as the subject
   of an edge, hide it and confirm the hide suppresses it family-wide (and overrides a Steward
   affirmation, per ADR-0016). Confirm asserted edges are treated as fact on assertion — steward
   affirm is optional endorsement, not a visibility gate.
4. **Story-subject tagging (#35):** on a story you can see, tag a subject person and confirm
   `listStoriesAboutPerson` narrows correctly and never grants access to a story the viewer couldn't
   already see (the tag narrows within the authorized set; it never widens the front door).
5. **`/hub/tree` (visual tree):** ONLY if the canvas/page landed (see §0 Known Gap). Load `/hub/tree`,
   confirm a root-anchored bounded tree renders without error, death year/date show on deceased nodes,
   and expand/collapse works. **If the page was not landed, expect a 404 and confirm the tree was
   intentionally descoped from this release — do not report it as shipped.**
6. **Front-door regression spot-check:** confirm kinship did not widen content visibility — a
   non-member still cannot see a private story merely because a kinship edge connects them. (Covered
   by the ADR-0011 oracle in tests; a quick manual confirm is cheap insurance.)

---

## Risks the human should weigh before merging

1. **Visual tree renderer is wiring-incomplete on this branch** (§0 Known Gap): layout + core read
   exist and are tested, but no rendered `/hub/tree` route consumes them yet. Either confirm the
   Track-B canvas landed on `kin-a-release` before the gate, or ship the data/governance work and
   descope the visual tree — but do not deploy claiming a working tree page.
2. **Large migration frontier in one deploy** (0007 → 0011, four migrations). The drift guard proves
   internal consistency, but the parity gate against **prod Neon** is the real check — it must be
   green, and prod Neon must actually be at `0007` beforehand. A prod branch at an unexpected baseline
   turns an additive release into a drift outage.
3. **Migrate-then-build coupling.** `db:migrate` runs in the build; if the build later fails, the
   migrations have already applied to prod Neon (forward-only). Recovery is a forward-fix redeploy,
   not a DB rollback — plan for that, don't try to un-apply.
4. **Git-author gate is silent when it bites** (§4): a wrong-author merge commit produces a stuck
   release with no obvious error. Verify the `master` commit author immediately after merging.
5. **Reseed / trigger caveat:** 0009's append-only triggers are hand-carried DDL. The parity gate is
   what confirms they actually exist on prod after migrate — do not skip it.
