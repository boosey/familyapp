/**
 * Apply the schema (generated table DDL + custom invariants) to a PGlite instance. Shared by the
 * test harness (fresh in-memory DB per test) and any dev bootstrap (persistent dataDir).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = [
  "../drizzle/0000_init.sql",
  "../drizzle/custom/0001_invariants.sql",
];

export async function applyMigrations(pg: PGlite): Promise<void> {
  for (const rel of MIGRATIONS) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const sql = readFileSync(path, "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    await pg.exec(sql);
  }
}
