/**
 * #362 — the persistent narrator-memory store repository (write paths + the repointed interviewer
 * read). Covers: extracted-record insertion with provenance/confidence; user authoring; supersede
 * (new active + prior superseded with superseded_by); dismiss; the interviewer read returning only
 * active rows newest-first capped; and that extraction never overwrites a user-authored fact.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { narratorMemory } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authorNarratorMemory,
  createTextDraft,
  dismissNarratorMemory,
  listNarratorMemoryForInterviewer,
  recordExtractedMemories,
  supersedeNarratorMemory,
} from "../src/index";
import { InvariantViolation } from "../src/errors";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A real story id (narrator_memory.source_story_id has a plain FK to stories.id). */
async function makeStory(ownerPersonId: string): Promise<string> {
  const { story } = await createTextDraft(db, { ownerPersonId, text: "seed" });
  return story.id;
}

async function rowsFor(personId: string) {
  return db.select().from(narratorMemory).where(eq(narratorMemory.personId, personId));
}

describe("recordExtractedMemories", () => {
  it("inserts one active extracted row per fact, carrying sourceStoryId + confidence", async () => {
    const p = await makePerson(db, "Eleanor");
    const storyId = await makeStory(p.id);
    await recordExtractedMemories(db, {
      personId: p.id,
      source: "story",
      sourceStoryId: storyId,
      facts: [
        { title: "Baker", summary: "Ran a bakery.", tags: ["work"], confidence: 0.9 },
        { title: "Naples", summary: "From Naples.", tags: ["place", "origin"], confidence: 0.4 },
      ],
    });
    const rows = await rowsFor(p.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.origin).toBe("extracted");
      expect(r.status).toBe("active");
      expect(r.sourceStoryId).toBe(storyId);
    }
    const baker = rows.find((r) => r.title === "Baker")!;
    expect(baker.confidence).toBeCloseTo(0.9);
    expect(baker.tags).toEqual(["work"]);
  });

  it("carries null sourceStoryId when omitted (intake path)", async () => {
    const p = await makePerson(db, "Eleanor");
    await recordExtractedMemories(db, {
      personId: p.id,
      source: "intake",
      facts: [{ title: "T", summary: "S", tags: [], confidence: 0.5 }],
    });
    const [row] = await rowsFor(p.id);
    expect(row!.sourceStoryId).toBeNull();
  });

  it("is a no-op on empty facts", async () => {
    const p = await makePerson(db, "Eleanor");
    await recordExtractedMemories(db, { personId: p.id, source: "story", facts: [] });
    expect(await rowsFor(p.id)).toHaveLength(0);
  });
});

describe("authorNarratorMemory", () => {
  it("inserts an active user row with no source/confidence", async () => {
    const p = await makePerson(db, "Eleanor");
    const id = await authorNarratorMemory(db, {
      personId: p.id,
      title: "Loves gardening",
      summary: "Tends roses every morning.",
      tags: ["hobby"],
    });
    const [row] = await rowsFor(p.id);
    expect(row!.id).toBe(id);
    expect(row!.origin).toBe("user");
    expect(row!.status).toBe("active");
    expect(row!.sourceStoryId).toBeNull();
    expect(row!.confidence).toBeNull();
  });
});

describe("supersedeNarratorMemory", () => {
  it("inserts a new active row and marks the prior superseded, pointing at the replacement", async () => {
    const p = await makePerson(db, "Eleanor");
    const priorId = await authorNarratorMemory(db, {
      personId: p.id,
      title: "Old",
      summary: "Old summary.",
      tags: [],
    });
    const newId = await supersedeNarratorMemory(db, {
      memoryId: priorId,
      replacement: { title: "New", summary: "New summary.", tags: ["x"] },
    });

    const [prior] = await db
      .select()
      .from(narratorMemory)
      .where(eq(narratorMemory.id, priorId));
    const [replacement] = await db
      .select()
      .from(narratorMemory)
      .where(eq(narratorMemory.id, newId));

    expect(prior!.status).toBe("superseded");
    expect(prior!.supersededBy).toBe(newId);
    expect(replacement!.status).toBe("active");
    expect(replacement!.origin).toBe("user");
    expect(replacement!.title).toBe("New");
  });

  it("refuses to supersede a non-active row", async () => {
    const p = await makePerson(db, "Eleanor");
    const id = await authorNarratorMemory(db, {
      personId: p.id,
      title: "A",
      summary: "B",
      tags: [],
    });
    await dismissNarratorMemory(db, { memoryId: id });
    await expect(
      supersedeNarratorMemory(db, {
        memoryId: id,
        replacement: { title: "C", summary: "D", tags: [] },
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("dismissNarratorMemory", () => {
  it("flips an active row to dismissed", async () => {
    const p = await makePerson(db, "Eleanor");
    const id = await authorNarratorMemory(db, {
      personId: p.id,
      title: "A",
      summary: "B",
      tags: [],
    });
    await dismissNarratorMemory(db, { memoryId: id });
    const [row] = await db.select().from(narratorMemory).where(eq(narratorMemory.id, id));
    expect(row!.status).toBe("dismissed");
  });

  it("refuses to dismiss an already non-active row", async () => {
    const p = await makePerson(db, "Eleanor");
    const id = await authorNarratorMemory(db, { personId: p.id, title: "A", summary: "B", tags: [] });
    await dismissNarratorMemory(db, { memoryId: id });
    await expect(dismissNarratorMemory(db, { memoryId: id })).rejects.toBeInstanceOf(
      InvariantViolation,
    );
  });
});

describe("listNarratorMemoryForInterviewer (repointed onto the store)", () => {
  it("returns only active rows, newest-first, capped, with the drop-in shape", async () => {
    const p = await makePerson(db, "Eleanor");
    const first = await authorNarratorMemory(db, { personId: p.id, title: "1", summary: "s1", tags: ["a"] });
    await authorNarratorMemory(db, { personId: p.id, title: "2", summary: "s2", tags: [] });
    const third = await authorNarratorMemory(db, { personId: p.id, title: "3", summary: "s3", tags: [] });
    // Dismiss the first so it must NOT appear.
    await dismissNarratorMemory(db, { memoryId: first });

    const rows = await listNarratorMemoryForInterviewer(db, p.id, 10);
    expect(rows.map((r) => r.title)).toEqual(["3", "2"]); // newest-first, first dismissed out
    const row = rows[0]!;
    expect(row.storyId).toBe(third); // user rows have no source story → storyId = id
    expect(row.promptQuestion).toBeNull();
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "promptQuestion", "storyId", "summary", "tags", "title"].sort(),
    );
  });

  it("uses source_story_id as storyId for extracted rows", async () => {
    const p = await makePerson(db, "Eleanor");
    const storyId = await makeStory(p.id);
    await recordExtractedMemories(db, {
      personId: p.id,
      source: "story",
      sourceStoryId: storyId,
      facts: [{ title: "T", summary: "S", tags: [], confidence: 1 }],
    });
    const rows = await listNarratorMemoryForInterviewer(db, p.id, 10);
    expect(rows[0]!.storyId).toBe(storyId);
  });

  it("caps at the requested limit", async () => {
    const p = await makePerson(db, "Eleanor");
    for (let i = 0; i < 4; i++) {
      await authorNarratorMemory(db, { personId: p.id, title: `t${i}`, summary: "s", tags: [] });
    }
    const rows = await listNarratorMemoryForInterviewer(db, p.id, 2);
    expect(rows).toHaveLength(2);
  });

  it("does not surface another person's rows", async () => {
    const p = await makePerson(db, "Eleanor");
    const other = await makePerson(db, "Other");
    await authorNarratorMemory(db, { personId: other.id, title: "x", summary: "y", tags: [] });
    expect(await listNarratorMemoryForInterviewer(db, p.id, 10)).toHaveLength(0);
  });
});

describe("extraction precedence (structural)", () => {
  it("never overwrites a user-authored fact — extraction only inserts new rows", async () => {
    const p = await makePerson(db, "Eleanor");
    const userId = await authorNarratorMemory(db, {
      personId: p.id,
      title: "Loves gardening",
      summary: "Authored by the narrator.",
      tags: [],
    });
    const storyId = await makeStory(p.id);
    await recordExtractedMemories(db, {
      personId: p.id,
      source: "story",
      sourceStoryId: storyId,
      facts: [{ title: "Loves gardening", summary: "Mined from a story.", tags: [], confidence: 0.7 }],
    });
    // The user row is byte-for-byte unchanged; both rows coexist as active.
    const [userRow] = await db
      .select()
      .from(narratorMemory)
      .where(eq(narratorMemory.id, userId));
    expect(userRow!.origin).toBe("user");
    expect(userRow!.summary).toBe("Authored by the narrator.");
    const active = await db
      .select()
      .from(narratorMemory)
      .where(and(eq(narratorMemory.personId, p.id), eq(narratorMemory.status, "active")));
    expect(active).toHaveLength(2);
  });
});
