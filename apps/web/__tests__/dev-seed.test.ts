/**
 * Regression tests for the dev seed's identity model and seed-data shape.
 *
 * Bug (locked in by this suite): Eleanor (a narrator) was seeded as a Person with NO Account, on a
 * now-rejected "the link token IS the narrator's identity" assumption. Effect: she never appeared in
 * the hub's "Switch user" list (built by an inner join on `accounts`) and could not sign into the
 * hub at all.
 *
 * The corrected domain rule: EVERY user has an Account. "Narrator" / "asker" is a role, not an
 * account distinction — the capture/question link is only a convenience login into an existing
 * account. These tests lock that in so a future seed edit can't regress a narrator to account-less.
 *
 * Additional shape checks: Eleanor must have ≥ 4 pending Asks and exactly one DRAFT story linked
 * to an Ask (state='draft', askId not null) so the hub's Questions tab shows "Review & approve"
 * immediately.
 */
import { describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { accounts, asks, persons } from "@chronicle/db/schema";
import { listOutstandingAnswerDrafts } from "@chronicle/core";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { seedInto } from "../lib/dev-seed";

async function seededDb() {
  const db = await createTestDatabase();
  const storage = new InMemoryMediaStorage();
  const result = await seedInto(db, storage);
  return { db, result };
}

describe("dev seed — every Person has an Account", () => {
  it("seeds no account-less Persons", async () => {
    const { db } = await seededDb();
    const orphans = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .where(isNull(persons.accountId));
    expect(orphans).toEqual([]);
  });

  it("gives Eleanor (the narrator) an Account, so the dev sign-in list includes her", async () => {
    const { db } = await seededDb();
    // Mirror listAccountPersons() in app/dev/sign-in/page.tsx: the inner join is what hid Eleanor.
    const signInOptions = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .innerJoin(accounts, eq(accounts.id, persons.accountId));
    const names = signInOptions.map((p) => p.displayName);
    expect(names).toContain("Eleanor Boudreaux");
    expect(names).toContain("Sofia Boudreaux");
    expect(names).toContain("Marco Boudreaux");
  });

  it("Eleanor is onboarded so she lands on the hub, not the /welcome gate", async () => {
    const { db, result } = await seededDb();
    const [eleanor] = await db
      .select({ onboardedAt: persons.onboardedAt })
      .from(persons)
      .where(eq(persons.id, result.narratorPersonId));
    expect(eleanor?.onboardedAt).not.toBeNull();
  });
});

describe("dev seed — Eleanor's question queue", () => {
  it("gives Eleanor at least 4 pending Asks so her 'Questions for you' tab has a real queue", async () => {
    const { db, result } = await seededDb();
    const pending = await db
      .select({ status: asks.status })
      .from(asks)
      .where(eq(asks.targetPersonId, result.narratorPersonId));
    expect(pending.length).toBeGreaterThanOrEqual(4);
    expect(pending.every((a) => a.status === "queued")).toBe(true);
  });

  it("seeds exactly one outstanding DRAFT story linked to an Ask for Eleanor", async () => {
    const { db, result } = await seededDb();
    const drafts = await listOutstandingAnswerDrafts(db, result.narratorPersonId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.askId).not.toBeNull();
    expect(drafts[0]!.storyId).toBe(result.draftStoryId);
  });
});
