/**
 * #362 — the `chronicle_narrator_memory_guard` trigger (invariants.sql). Narrator-memory is
 * append-only in its CONTENT but its lifecycle is mutable: a content-column UPDATE must RAISE, while
 * a `status` / `superseded_by` UPDATE must succeed. DELETE is intentionally unguarded (erasure).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { narratorMemory, persons } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName, spokenName: displayName }).returning();
  return p!;
}

async function makeActiveRow(personId: string) {
  const [row] = await db
    .insert(narratorMemory)
    .values({ personId, title: "Baker", summary: "Ran a bakery in Naples.", origin: "user" })
    .returning();
  return row!;
}

describe("narrator_memory content-immutability guard", () => {
  it("permits a status transition (active → superseded) and setting superseded_by", async () => {
    const p = await makePerson();
    const prior = await makeActiveRow(p.id);
    const replacement = await makeActiveRow(p.id);

    await expect(
      db
        .update(narratorMemory)
        .set({ status: "superseded", supersededBy: replacement.id })
        .where(eq(narratorMemory.id, prior.id)),
    ).resolves.toBeDefined();

    const [after] = await db
      .select()
      .from(narratorMemory)
      .where(eq(narratorMemory.id, prior.id));
    expect(after!.status).toBe("superseded");
    expect(after!.supersededBy).toBe(replacement.id);
  });

  it("permits a status transition to dismissed", async () => {
    const p = await makePerson();
    const row = await makeActiveRow(p.id);
    await expect(
      db.update(narratorMemory).set({ status: "dismissed" }).where(eq(narratorMemory.id, row.id)),
    ).resolves.toBeDefined();
  });

  it("RAISEs when a content column changes (title)", async () => {
    const p = await makePerson();
    const row = await makeActiveRow(p.id);
    await expect(
      db.update(narratorMemory).set({ title: "Different" }).where(eq(narratorMemory.id, row.id)),
    ).rejects.toThrow(/content is immutable/i);
  });

  it("RAISEs when tags change", async () => {
    const p = await makePerson();
    const row = await makeActiveRow(p.id);
    await expect(
      db.update(narratorMemory).set({ tags: ["x"] }).where(eq(narratorMemory.id, row.id)),
    ).rejects.toThrow(/content is immutable/i);
  });

  it("RAISEs when a content column changes even alongside a legal status change", async () => {
    const p = await makePerson();
    const row = await makeActiveRow(p.id);
    await expect(
      db
        .update(narratorMemory)
        .set({ status: "dismissed", summary: "tampered" })
        .where(eq(narratorMemory.id, row.id)),
    ).rejects.toThrow(/content is immutable/i);
  });

  it("permits DELETE (erasure is unguarded)", async () => {
    const p = await makePerson();
    const row = await makeActiveRow(p.id);
    await db.delete(narratorMemory).where(eq(narratorMemory.id, row.id));
    const rows = await db.select().from(narratorMemory).where(eq(narratorMemory.personId, p.id));
    expect(rows).toHaveLength(0);
  });
});
