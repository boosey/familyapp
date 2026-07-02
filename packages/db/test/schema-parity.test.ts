/**
 * Schema-parity guard.
 *
 * The prod Neon DB silently drifted from `drizzle/schema.sql`: `applySchemaToPostgres` is
 * bootstrap-only (probes `persons` and returns early once present), so tables/columns/enum values
 * added AFTER first boot were never applied. The running app then 500'd at query time with
 * Postgres 42703 "column ... does not exist" — invisible until a user hit the page.
 *
 * These tests pin the guard that turns that silent runtime failure into an explicit, descriptive
 * boot/CI error naming exactly what the live DB is missing. The `parseExpectedSchema(schemaSql())`
 * case is the regression: it asserts the exact objects that were missing in the incident.
 */
import { describe, expect, it } from "vitest";
import { createPgliteDatabase } from "../src/client";
import { applySchema, schemaSql } from "../src/migrate";
import {
  parseExpectedSchema,
  introspectSchema,
  diffSchema,
  assertSchemaParity,
} from "../src/schema-parity";

/** A row executor bound to a PGlite handle (the shape `assertSchemaParity`/`introspectSchema` want). */
function pgliteRunner(db: ReturnType<typeof createPgliteDatabase>) {
  return (q: string) =>
    db.$pglite!.query(q).then((r) => r.rows as Record<string, unknown>[]);
}

describe("parseExpectedSchema", () => {
  it("parses a fixture in the real drizzle format (post-table ALTER/index lines are not columns)", () => {
    // Mirrors how drizzle-kit actually emits DDL: table body has only columns; constraints and
    // indexes are separate statements AFTER the table. None of those trailing lines — nor a
    // quoted identifier inside an ADD CONSTRAINT — may be mistaken for a column.
    const sql = [
      `CREATE TYPE "public"."color" AS ENUM('red', 'green', 'blue');`,
      `CREATE TABLE "widgets" (`,
      `\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,`,
      `\t"label" text NOT NULL`,
      `);`,
      `ALTER TABLE "widgets" ADD CONSTRAINT "widgets_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;`,
      `CREATE UNIQUE INDEX "widgets_label_uq" ON "widgets" USING btree ("label");`,
    ].join("\n");
    const parsed = parseExpectedSchema(sql);
    expect(parsed.tables).toEqual({ widgets: ["id", "label"] });
    expect(parsed.enums).toEqual({ color: ["red", "green", "blue"] });
  });

  it("also ignores an inline CONSTRAINT line inside a table body (defensive)", () => {
    const sql = [
      `CREATE TABLE "widgets" (`,
      `\t"id" uuid PRIMARY KEY NOT NULL,`,
      `\t"label" text NOT NULL,`,
      `\tCONSTRAINT "widgets_label_uq" UNIQUE("label")`,
      `);`,
    ].join("\n");
    expect(parseExpectedSchema(sql).tables).toEqual({ widgets: ["id", "label"] });
  });

  it("yields nothing for text with no CREATE TABLE/TYPE (e.g. invariants.sql triggers)", () => {
    const parsed = parseExpectedSchema(
      "CREATE OR REPLACE FUNCTION foo() RETURNS trigger AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
    );
    expect(parsed.tables).toEqual({});
    expect(parsed.enums).toEqual({});
  });

  it("on the REAL schema, includes exactly the objects missing in the Neon drift incident", () => {
    const parsed = parseExpectedSchema(schemaSql());
    // stories.originating_family_id — the column that produced the 42703.
    expect(parsed.tables.stories).toContain("originating_family_id");
    // Tables added after bootstrap.
    expect(parsed.tables.story_families).toBeDefined();
    expect(parsed.tables.intake_answers).toBeDefined();
    // Enum value added to an existing type + a wholly new enum type.
    expect(parsed.enums.media_kind).toContain("intake_audio");
    expect(parsed.enums.intake_origin).toBeDefined();
    expect(parsed.enums.intake_origin).toEqual(["voice", "typed"]);
  });
});

describe("diffSchema", () => {
  const expected = {
    tables: { stories: ["id", "originating_family_id"], intake_answers: ["id"] },
    enums: { media_kind: ["story_audio", "intake_audio"] },
  };

  it("reports a missing table, a missing column, and a missing enum value", () => {
    const actual = {
      tables: { stories: ["id"] }, // missing originating_family_id + intake_answers table
      enums: { media_kind: ["story_audio"] }, // missing intake_audio value
    };
    const problems = diffSchema(expected, actual);
    expect(problems.some((p) => p.includes("intake_answers"))).toBe(true);
    expect(problems.some((p) => p.includes("originating_family_id"))).toBe(true);
    expect(problems.some((p) => p.includes("intake_audio"))).toBe(true);
  });

  it("reports a missing enum TYPE", () => {
    const problems = diffSchema(
      { tables: {}, enums: { intake_origin: ["voice", "typed"] } },
      { tables: {}, enums: {} },
    );
    expect(problems.some((p) => p.includes("intake_origin"))).toBe(true);
  });

  it("returns [] when actual is a superset of expected (extra objects are fine)", () => {
    const actual = {
      tables: {
        stories: ["id", "originating_family_id", "extra_col"],
        intake_answers: ["id", "text"],
        extra_table: ["id"],
      },
      enums: { media_kind: ["story_audio", "intake_audio", "extra_value"], extra_enum: ["x"] },
    };
    expect(diffSchema(expected, actual)).toEqual([]);
  });
});

describe("introspectSchema + assertSchemaParity (integration, PGlite)", () => {
  it("a fresh DB with the full schema matches schema.sql (no throw)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    const run = pgliteRunner(db);

    // introspect returns the real objects.
    const actual = await introspectSchema(run);
    expect(actual.tables.stories).toContain("originating_family_id");
    expect(actual.enums.media_kind).toContain("intake_audio");

    // full parity check resolves.
    await expect(assertSchemaParity(run)).resolves.toBeUndefined();
  });

  it("throws a descriptive error when the live DB is missing a column (drifted DB)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    // Simulate drift: drop the exact column that was missing in the incident.
    await db.$pglite!.exec(`ALTER TABLE "stories" DROP COLUMN "originating_family_id";`);
    const run = pgliteRunner(db);

    await expect(assertSchemaParity(run)).rejects.toThrow(/originating_family_id/);
  });

  it("real introspection reports a missing enum TYPE (empty DB lacks intake_origin)", async () => {
    // A bare public schema (never bootstrapped) has no enum types. Introspection must SEE their
    // absence — the incident's `intake_origin` was a wholly missing type, not just a missing value.
    const db = createPgliteDatabase();
    const run = pgliteRunner(db);
    const actual = await introspectSchema(run);
    expect(actual.enums.intake_origin).toBeUndefined();
    await expect(assertSchemaParity(run)).rejects.toThrow(/missing enum type "intake_origin"/);
  });

  it("throws when the live DB is missing an enum value (drift on an existing type)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    const run = pgliteRunner(db);
    // Inject an expected schema that demands an enum value the DB does not have.
    await expect(
      assertSchemaParity(run, {
        expected: { tables: {}, enums: { media_kind: ["a_value_that_does_not_exist"] } },
      }),
    ).rejects.toThrow(/a_value_that_does_not_exist/);
  });
});
