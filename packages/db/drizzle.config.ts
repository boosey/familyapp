import { defineConfig } from "drizzle-kit";

// This one config drives BOTH artifacts derived from schema.ts (the single source of truth):
//   - the SNAPSHOT: `pnpm db:generate` (scripts/gen-schema.mjs) runs `drizzle-kit export` to
//     regenerate drizzle/schema.sql, the full DDL (applied wholesale for PGlite tests + dev seed).
//   - the CHAIN: `drizzle-kit generate` diffs schema.ts and writes numbered migrations into `out`
//     (drizzle/migrations), the incremental, journal-tracked path applied non-destructively to Neon.
// `drizzle-kit export` prints to stdout and ignores `out`, so the two paths don't collide.
// Triggers, the append-only / media-immutability guards, and the partial unique indexes (things
// drizzle-kit does not model) live in drizzle/invariants.sql — applied right after schema.sql for
// the snapshot, and hand-carried into migration files for the chain. See src/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle/migrations",
});
