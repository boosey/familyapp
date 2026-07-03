/**
 * Regression tests for ADR-0007 — a Story is origin-typed (`voice` | `text`). A `voice` story has
 * a canonical audio recording; a `text` story is typed (its words are canonical, no recording).
 * Audio is the source of truth ONLY when present, so `stories.recording_media_id` is nullable and a
 * `user_authored` provenance level precedes any AI step for typed prose.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("stories.kind (ADR-0007)", () => {
  it("has a story_kind enum with 'text' and 'voice'", async () => {
    const res = await db.$pglite!.query(
      "SELECT unnest(enum_range(NULL::story_kind))::text AS v ORDER BY v",
    );
    const values = (res.rows as Array<{ v: string }>).map((r) => r.v);
    expect(values).toEqual(["text", "voice"]);
  });

  it("prose_revision_level includes 'user_authored'", async () => {
    const res = await db.$pglite!.query(
      "SELECT unnest(enum_range(NULL::prose_revision_level))::text AS v",
    );
    const values = (res.rows as Array<{ v: string }>).map((r) => r.v);
    expect(values).toContain("user_authored");
  });
});
