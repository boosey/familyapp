/**
 * Core side of live Story date derivation (issue #243, ADR-0026), tested over real in-process
 * PGlite (zero mocking) like the rest of the story-repository suite:
 *   - `listLifeEventsForPerson` — the read side of the life-events anchor table that feeds the
 *     interviewer's session context;
 *   - `applyResolvedStoryDate` — the derivation path's write shape, persisting a resolved
 *     occurrence (with its provenance note) through the `updateDerivedFields` seam;
 *   - `getNarratorBiographicalContext` — now carries the full birth date (the primary anchor).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { lifeEvents, persons } from "@chronicle/db/schema";
import {
  applyResolvedStoryDate,
  getNarratorBiographicalContext,
  listLifeEventsForPerson,
  persistRecordingAndCreateDraft,
} from "../src/index";

let db: Database;

beforeEach(async () => {
  db = await createTestDatabase();
});

async function createPerson(name: string, birthDate?: string): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name, ...(birthDate ? { birthDate } : {}) })
    .returning();
  return p!.id;
}

describe("listLifeEventsForPerson", () => {
  it("returns the person's events as derivation anchors, in date order", async () => {
    const personId = await createPerson("Eleanor");
    await db.insert(lifeEvents).values([
      {
        personId,
        kind: "graduation",
        occurredKind: "date",
        occurredDate: "1953-06-30",
        occurredProvenance: "stated in a story follow-up",
      },
      {
        personId,
        kind: "wedding",
        occurredKind: "date",
        occurredDate: "1955-04-02",
        occurredProvenance: "stated in a story follow-up",
      },
    ]);

    const anchors = await listLifeEventsForPerson(db, personId);
    expect(anchors).toEqual([
      { kind: "graduation", date: "1953-06-30" },
      { kind: "wedding", date: "1955-04-02" },
    ]);
  });

  it("a period event contributes its span start as the anchor date", async () => {
    const personId = await createPerson("Eleanor");
    await db.insert(lifeEvents).values({
      personId,
      kind: "military_service",
      occurredKind: "period",
      occurredDate: "1951-09-01",
      occurredEndDate: "1955-06-01",
    });

    const anchors = await listLifeEventsForPerson(db, personId);
    expect(anchors).toEqual([{ kind: "military_service", date: "1951-09-01" }]);
  });

  it("excludes other people's events and returns [] when none are known", async () => {
    const personId = await createPerson("Eleanor");
    const otherId = await createPerson("Marcus");
    await db.insert(lifeEvents).values({
      personId: otherId,
      kind: "wedding",
      occurredKind: "date",
      occurredDate: "1960-01-01",
    });

    expect(await listLifeEventsForPerson(db, personId)).toEqual([]);
  });
});

describe("applyResolvedStoryDate", () => {
  it("persists a resolved occurrence with its provenance through the derived-fields seam", async () => {
    const ownerId = await createPerson("Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: ownerId,
      storageKey: "take0.webm",
      contentType: "audio/webm",
      checksum: "fake-checksum",
    });
    expect(story.occurredKind).toBeNull();

    const updated = await applyResolvedStoryDate(db, story.id, {
      kind: "date",
      date: "1943-12-25",
      endDate: null,
      provenance: "age 8 at Christmas, from birthdate",
    });

    expect(updated.occurredKind).toBe("date");
    expect(updated.occurredDate).toBe("1943-12-25");
    expect(updated.occurredEndDate).toBeNull();
    expect(updated.occurredProvenance).toBe("age 8 at Christmas, from birthdate");
  });

  it("persists a period with both span bounds", async () => {
    const ownerId = await createPerson("Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: ownerId,
      storageKey: "take0.webm",
      contentType: "audio/webm",
      checksum: "fake-checksum",
    });

    const updated = await applyResolvedStoryDate(db, story.id, {
      kind: "period",
      date: "1949-09-01",
      endDate: "1953-06-30",
      provenance: "high school years, from birthdate",
    });

    expect(updated.occurredKind).toBe("period");
    expect(updated.occurredDate).toBe("1949-09-01");
    expect(updated.occurredEndDate).toBe("1953-06-30");
    expect(updated.occurredProvenance).toBe("high school years, from birthdate");
  });
});

describe("getNarratorBiographicalContext", () => {
  it("carries the full birth date (the primary derivation anchor), null when unknown", async () => {
    const withDate = await createPerson("Eleanor", "1935-06-15");
    const withoutDate = await createPerson("Marcus");

    const ctx = await getNarratorBiographicalContext(db, withDate);
    expect(ctx?.birthDate).toBe("1935-06-15");

    const ctxWithout = await getNarratorBiographicalContext(db, withoutDate);
    expect(ctxWithout?.birthDate).toBeNull();
  });
});
