# Database Migrations — Design

**Date:** 2026-07-04
**Status:** Implemented (2026-07-04). The drizzle-kit migration chain (`drizzle/migrations/0000_baseline.sql` + `0001`/`0002` + `meta/`) shipped and applies to Neon via `db:migrate` in the Vercel build; the snapshot drift-guard test bonds it to `schema.sql`. This document is retained as the design record.
**Package:** `@chronicle/db` (plus a Vercel build-step change)

## Motivation

Today `@chronicle/db` uses a **single-schema, no-migrations** model. `schema.ts` is the
source of truth; `pnpm db:generate` runs `drizzle-kit export` to regenerate the *entire*
`drizzle/schema.sql`, applied alongside hand-maintained `drizzle/invariants.sql` (triggers,
append-only / media-immutability guards, partial unique indexes — things drizzle-kit cannot
model). Three apply primitives exist:

- `applySchema(pg)` — idempotent create-if-empty (PGlite tests, dev boot).
- `resetSchema(db)` — destructive DROP SCHEMA + re-apply (dev seed).
- `applySchemaToPostgres(sql)` — **bootstrap-only, never drops.**

`applySchemaToPostgres` being bootstrap-only is what froze Neon at first-boot schema and
produced `42703` (undefined column) crashes in production. The current mitigation is a
schema-parity check wired into the Vercel `buildCommand` that **fails the deploy** when
`schema.ts` drifts from Neon; the only remedy is to manually `DROP SCHEMA` reset both Neon
branches, destroying their data.

There is therefore **no forward migration path**: schema changes reach Neon only by blowing it
away.

### Trigger for doing this now

No critical data exists yet (no real users). This is the ideal window to stand up the real
migration workflow **while blow-away is still a safe fallback**, so the workflow is
battle-tested before the first real user makes it load-bearing.

## Decisions (settled during brainstorming)

1. **Engine = drizzle-kit** (already installed). Postgres has no native migration tool; Neon is
   just managed Postgres and its docs point at exactly this. `drizzle-kit generate` +
   `drizzle-orm`'s `migrate()` is a real, journal-tracked, checksummed migration system
   (`__drizzle_migrations`). We are not rolling our own engine. Atlas (the one tool that manages
   triggers as first-class objects) was considered and rejected as overkill / a competing
   toolchain for the current stage.
2. **`schema.ts` stays the single source of truth.** It is too embedded (the single front door,
   re-exported domain types) to dethrone. We do **not** introspect/pull the schema back from the
   database.
3. **Dev + tests keep the fast snapshot model; migrations govern only Neon.** Tests keep
   applying `schema.sql` + `invariants.sql` wholesale; the dev seed keeps `resetSchema`. A single
   drift-guard test bonds the snapshot to the migration chain so they cannot silently diverge.
4. **Migrations run in the Vercel `buildCommand`** (replacing the parity-gate) against the
   deployment's Neon branch. A separate release step / GitHub Action was considered and deferred.
5. **Previews point at the shared dev Neon branch.** Per-PR Neon branches were considered and
   deferred until isolation is actually needed.

## Architecture

### Two artifacts, one source of truth

`schema.ts` → two derived artifacts:

| Artifact | What it is | Consumers |
|---|---|---|
| **Snapshot** — `drizzle/schema.sql` + `drizzle/invariants.sql` (exists today) | Full *current* DDL, applied wholesale | PGlite tests (`applySchema`), dev seed (`resetSchema`) — fast path |
| **Migration chain** — `drizzle/migrations/NNNN_*.sql` + `meta/_journal.json` + snapshots (new) | *Ordered incremental* steps, tracked in `__drizzle_migrations` | Neon prod + preview branches — durable path |

- Snapshot answers "what does the schema look like *now*" — fast to apply, freely rebuilt.
- Chain answers "how do you bring an existing database forward to now" — never destructive.

**Invariant property:** the snapshot and the chain must always produce **byte-identical**
databases. This is enforced as a failing test (see Drift Guard), not left to hope.

### Forward workflow (per schema change)

1. Edit `schema.ts`.
2. `pnpm db:generate` →
   - regenerates the snapshot `drizzle/schema.sql` (as today), **and**
   - runs `drizzle-kit generate` to emit one new numbered migration for the modeled diff.
3. If the change touches an invariant (trigger / append-only guard / partial unique index):
   hand-edit `invariants.sql` (snapshot) **and** hand-append the same SQL to the new migration
   file. This is the sole point requiring discipline; the drift guard catches omissions.
4. Deploy → Neon applies only the pending migrations, non-destructively.

### Invariants handling

Drizzle-kit cannot model triggers/functions/partial-unique-indexes — this is true of every
schema-diff tool (Prisma included), not a drizzle-specific gap. Invariant changes are therefore
carried by hand into the migration file that needs them. The initial baseline migration
(`0000`) inlines the full current `invariants.sql`. The drift guard (below) is what makes this
hand-carrying safe.

## Drift Guard (new test in `@chronicle/db`)

Builds two fresh PGlite databases:

- **DB-A**: `applySchema` (snapshot: `schema.sql` + `invariants.sql`).
- **DB-B**: replay the migration chain from empty (`0000` → latest).

Introspects both via `pg_catalog` / `information_schema` — tables, columns, types, constraints,
indexes, **triggers**, functions — and asserts they are identical. Because it compares actual
database state (not drizzle's partial model), it covers invariants too. This catches the
canonical hand-management error: "added an index to `invariants.sql` but forgot the migration."
If snapshot and chain disagree, CI goes red before anything reaches Neon.

**Companion check:** CI also runs the standard drizzle drift check (`drizzle-kit generate` into
a temp dir; assert no new file is produced) so a `schema.ts` edit with *no* migration fails
immediately with a clear message rather than as a mysterious downstream diff.

## Neon Execution

Replace `applySchemaToPostgres` (bootstrap-only) with a real migrate runner: a small
`migrate.ts` entry using `drizzle-orm/postgres-js`'s `migrate()` against the branch's
`DATABASE_URL`. Applies only pending migrations, transactionally, recording them in
`__drizzle_migrations`.

- **Where:** an explicit step in the Vercel `buildCommand`, before the app build, against that
  deployment's Neon branch (prod branch for production; shared dev branch for previews).
- Replaces the parity-gate-that-fails-the-deploy with migrate-that-advances-the-branch.
- The existing parity check is retained as a **post-migrate assertion** (belt-and-suspenders),
  no longer the gate.

## One-Time Bootstrap (the only destructive step)

Safe now (no critical data), painful once there are users:

1. `drizzle-kit generate` from empty → `0000_baseline.sql` = current modeled schema. Hand-append
   current `invariants.sql` into it so `0000` == today's full schema.
2. `DROP SCHEMA` reset both Neon branches once; run `migrate()` → both land at `0000` with
   `__drizzle_migrations` stamped.
3. Thereafter every change is an additive `0001`, `0002`, … — no further resets.

## Testing

- Drift-guard test (snapshot ≡ chain), as above.
- Drizzle "no pending migration" check in CI.
- A migration-replay smoke test (chain replays cleanly from empty) is subsumed by the drift
  guard's DB-B construction.
- Existing PGlite-based tests are unaffected — they still use `applySchema`.

## Out of Scope / Deferred

- Separate release-step / GitHub Action for migrations (staying in `buildCommand`).
- Per-PR isolated Neon branches (previews share the dev branch).
- Data backfills / transformation migrations — none needed yet (no data); the file format
  (hand-authored SQL) already supports them when needed.
- Atlas or any non-drizzle migration engine.
- Down/rollback migrations — forward-only; roll back by writing a new forward migration.

## Risks

- **Hand-carried invariants can be forgotten.** Mitigated by the drift guard (hard CI failure).
- **Migrating in the build** runs DB writes from the build machine and couples deploy timing to
  DB availability. Accepted for now; the migrate step is transactional and idempotent, and this
  matches the existing parity-gate placement.
- **Shared preview branch** means preview deploys mutate a shared dev schema. Acceptable while
  there is no preview data worth isolating.
