import { defineConfig } from "drizzle-kit";

// Single-schema dev model (no incremental migrations). `pnpm db:generate` (scripts/gen-schema.mjs)
// runs `drizzle-kit export` against schema.ts — the single source of truth — to regenerate
// drizzle/schema.sql, the full DDL. Triggers, the append-only / media-immutability guards, and the
// partial unique indexes (things drizzle-kit does not model) live in drizzle/invariants.sql and are
// applied right after schema.sql. See src/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
