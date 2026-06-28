/**
 * Regression: the hub feed must include the LOGGED-IN viewer's own stories.
 *
 * Bug: `loadHubFeed` built the feed from `familyCoMembers`, which excluded the viewer themselves
 * (`ne(persons.id, viewerPersonId)`). So a narrator like Eleanor — who owns many stories — saw an
 * empty Stories tab when logged into her own account, because her own stories were never queried.
 * The fix lists every active family member INCLUDING the viewer (owner always sees their own
 * content, any state — see decideStoryRead). These tests pin that, plus the dedup behavior.
 */
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { InMemoryMediaStorage } from "@chronicle/storage";
import type { AuthContext } from "@chronicle/core";
import { seedInto } from "../lib/dev-seed";
import { loadHubFeed } from "../lib/hub-data";

async function seeded() {
  const db = await createTestDatabase();
  const result = await seedInto(db, new InMemoryMediaStorage());
  return { db, result };
}

describe("loadHubFeed — viewer sees their own stories", () => {
  it("includes the logged-in owner's own stories (the Eleanor bug)", async () => {
    const { db, result } = await seeded();
    const eleanor = result.narratorPersonId;
    const ctx: AuthContext = { kind: "account", personId: eleanor };

    const feed = await loadHubFeed(db, ctx);
    const ownSlot = feed.find((slot) => slot.person.id === eleanor);

    expect(ownSlot).toBeDefined();
    expect(ownSlot!.stories.length).toBeGreaterThan(0);
    // Every story in the viewer's own slot is in fact owned by the viewer.
    expect(ownSlot!.stories.every((s) => s.ownerPersonId === eleanor)).toBe(true);
  });

  it("lists each person at most once (no duplicate slots)", async () => {
    const { db, result } = await seeded();
    const ctx: AuthContext = { kind: "account", personId: result.narratorPersonId };
    const feed = await loadHubFeed(db, ctx);
    const ids = feed.map((slot) => slot.person.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("returns nothing for an anonymous viewer", async () => {
    const { db } = await seeded();
    await expect(loadHubFeed(db, { kind: "anonymous" })).resolves.toEqual([]);
  });
});
