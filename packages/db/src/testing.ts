/**
 * Test/dev database harness. Spins up a fresh ephemeral PGlite (real Postgres, in-process),
 * applies the generated table DDL and then the custom invariants (triggers + partial unique
 * index). Every test gets an isolated database with the FULL production schema and all
 * structural guarantees in place — so the append-only ledger and media immutability are tested
 * exactly as they ship.
 */
import { createPgliteDatabase, type Database } from "./client";
import { applySchema } from "./migrate";

/** Create a fresh in-memory database with the complete schema + invariants applied. */
export async function createTestDatabase(): Promise<Database> {
  const db = createPgliteDatabase();
  await applySchema(db.$pglite!);
  return db;
}
