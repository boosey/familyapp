import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { updateBiographicalAnchor } from "../src/person-anchors";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function personId(): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Test", spokenName: "Test" })
    .returning();
  return p!.id;
}

describe("updateBiographicalAnchor", () => {
  it("merges one anchor key without clobbering others", async () => {
    const id = await personId();
    await updateBiographicalAnchor(db, id, "hometown", "New Orleans");
    await updateBiographicalAnchor(db, id, "hasChildren", true);
    const [row] = await db
      .select({ anchors: persons.biographicalAnchors })
      .from(persons)
      .where(eq(persons.id, id));
    expect(row!.anchors).toEqual({
      hometown: "New Orleans",
      hasChildren: true,
    });
  });

  it("can set a field back to null", async () => {
    const id = await personId();
    await updateBiographicalAnchor(db, id, "hometown", "New Orleans");
    await updateBiographicalAnchor(db, id, "hometown", null);
    const [row] = await db
      .select({ anchors: persons.biographicalAnchors })
      .from(persons)
      .where(eq(persons.id, id));
    expect(row!.anchors).toEqual({ hometown: null });
  });
});
