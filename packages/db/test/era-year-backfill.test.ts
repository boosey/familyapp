/**
 * #247 (ADR-0026): the era_year → occurred_* backfill (migration 0029_era_year_backfill).
 *
 * Runs the REAL hand-written data migration file against a seeded PGlite and pins the contract:
 *   - each stored era year becomes a year-aligned period (occurred_date YYYY-01-01 →
 *     occurred_end_date YYYY-12-31, so it displays as that bare year) with the
 *     'migrated from eraYear' provenance note;
 *   - a story with no era year stays Undated (a first-class state — never a fabricated date);
 *   - a story that already carries a Story date is NEVER clobbered (the guard is
 *     `occurred_kind IS NULL`), which also makes the migration idempotent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, stories, storyRecordings } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

const BACKFILL_SQL = readFileSync(
  fileURLToPath(new URL("../drizzle/migrations/0029_era_year_backfill.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName: string) {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

/** A story born in the pre-ADR-0026 world: an era year (or null) and no occurred_* value. */
async function makeStory(
  ownerPersonId: string,
  legacy: { eraYear: number | null; occurred?: { kind: "date"; date: string } },
) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://bucket/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: "abc123",
    })
    .returning();
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({
        ownerPersonId,
        recordingMediaId: rec!.id,
        eraYear: legacy.eraYear,
        occurredKind: legacy.occurred ? legacy.occurred.kind : null,
        occurredDate: legacy.occurred?.date ?? null,
      })
      .returning();
    // Seed take-0 so the story satisfies the ADR-0014 kind⇔recording biconditional.
    await tx
      .insert(storyRecordings)
      .values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
}

async function occurredOf(storyId: string) {
  const [row] = await db
    .select({
      eraYear: stories.eraYear,
      occurredKind: stories.occurredKind,
      occurredDate: stories.occurredDate,
      occurredEndDate: stories.occurredEndDate,
      occurredProvenance: stories.occurredProvenance,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);
  return row!;
}

describe("0029 era_year backfill (ADR-0026)", () => {
  it("converts each stored era year into a year-aligned period with migration provenance", async () => {
    const narrator = await makePerson("Eleanor");
    const s1943 = await makeStory(narrator.id, { eraYear: 1943 });
    const s1977 = await makeStory(narrator.id, { eraYear: 1977 });

    await db.$pglite!.exec(BACKFILL_SQL);

    expect(await occurredOf(s1943.id)).toEqual({
      eraYear: 1943, // the column itself is NOT dropped here (that's the contract ticket)
      occurredKind: "period",
      occurredDate: "1943-01-01",
      occurredEndDate: "1943-12-31",
      occurredProvenance: "migrated from eraYear",
    });
    const after1977 = await occurredOf(s1977.id);
    expect(after1977.occurredKind).toBe("period");
    expect(after1977.occurredDate).toBe("1977-01-01");
    expect(after1977.occurredEndDate).toBe("1977-12-31");
    expect(after1977.occurredProvenance).toBe("migrated from eraYear");
  });

  it("leaves a story with no era year Undated", async () => {
    const narrator = await makePerson("Eleanor");
    const undated = await makeStory(narrator.id, { eraYear: null });

    await db.$pglite!.exec(BACKFILL_SQL);

    const after = await occurredOf(undated.id);
    expect(after.occurredKind).toBeNull();
    expect(after.occurredDate).toBeNull();
    expect(after.occurredEndDate).toBeNull();
    expect(after.occurredProvenance).toBeNull();
  });

  it("never clobbers an existing Story date, and a second run changes nothing", async () => {
    const narrator = await makePerson("Eleanor");
    // era_year says 1950 but the telling already resolved an exact date — the backfill must not
    // touch it (guard: occurred_kind IS NULL).
    const dated = await makeStory(narrator.id, {
      eraYear: 1950,
      occurred: { kind: "date", date: "1950-12-25" },
    });

    await db.$pglite!.exec(BACKFILL_SQL);
    const once = await occurredOf(dated.id);
    await db.$pglite!.exec(BACKFILL_SQL); // idempotent: no-op on re-run
    const twice = await occurredOf(dated.id);

    expect(once.occurredKind).toBe("date");
    expect(once.occurredDate).toBe("1950-12-25");
    expect(once.occurredEndDate).toBeNull();
    expect(once.occurredProvenance).toBeNull();
    expect(twice).toEqual(once);
  });
});
