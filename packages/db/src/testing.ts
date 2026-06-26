/**
 * Test/dev database harness. Spins up a fresh ephemeral PGlite (real Postgres, in-process),
 * applies the generated table DDL and then the custom invariants (triggers + partial unique
 * index). Every test gets an isolated database with the FULL production schema and all
 * structural guarantees in place — so the append-only ledger and media immutability are tested
 * exactly as they ship.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPgliteDatabase, type Database } from "./client";

const MIGRATIONS = [
  "../drizzle/0000_init.sql",
  "../drizzle/custom/0001_invariants.sql",
];

/** Create a fresh in-memory database with the complete schema + invariants applied. */
export async function createTestDatabase(): Promise<Database> {
  const db = createPgliteDatabase();
  const pg = db.$pglite!;
  for (const rel of MIGRATIONS) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const sql = readFileSync(path, "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    await pg.exec(sql);
  }
  return db;
}
