/**
 * #337 — reconcileMentionAction server wiring. Steward happy path + non-steward refusal.
 * Mirrors pending-invites-actions.server.test.ts harness (mock runtime + revalidatePath).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { addMembership, addRelative, resolveKinshipProjection, type AuthContext } from "@chronicle/core";
import { reconcileMentionAction } from "@/app/hub/tree/kin-actions";

async function makePerson(name: string) {
  const [p] = await runtimeDb.insert(persons).values({ displayName: name }).returning();
  return p!;
}

async function makeSelfPerson(name: string) {
  const p = await makePerson(name);
  const [acct] = await runtimeDb
    .insert(accounts)
    .values({ authProviderUserId: `auth|${p.id}` })
    .returning();
  await runtimeDb
    .update(persons)
    .set({ origin: "self", accountId: acct!.id })
    .where(eq(persons.id, p.id));
  return p;
}

async function makeFamily(name: string, stewardId: string) {
  const { families } = await import("@chronicle/db/schema");
  const [fam] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: stewardId, stewardPersonId: stewardId })
    .returning();
  return fam!;
}

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function seed() {
  const steward = await makeSelfPerson("Steward");
  const fam = await makeFamily("Esposito", steward.id);
  await addMembership(runtimeDb, { personId: steward.id, familyId: fam.id, role: "member" });
  const child = await addRelative(runtimeDb, account(steward.id), {
    familyId: fam.id,
    relation: "child",
    displayName: "Mia",
  });
  const mentionPersonId = child.createdPersonId!;
  const real = await makeSelfPerson("Mia Real");
  await addMembership(runtimeDb, { personId: real.id, familyId: fam.id, role: "member" });
  return { steward, fam, mentionPersonId, accountPersonId: real.id };
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("reconcileMentionAction (#337)", () => {
  it("steward reconciles mention into account; mention leaves the projection", async () => {
    const { steward, fam, mentionPersonId, accountPersonId } = await seed();
    authCtx = { kind: "account", personId: steward.id };

    const before = await resolveKinshipProjection(runtimeDb, account(steward.id), fam.id);
    expect(before.edges.some((e) => e.personAId === mentionPersonId || e.personBId === mentionPersonId)).toBe(
      true,
    );

    const result = await reconcileMentionAction({
      familyId: fam.id,
      mentionPersonId,
      accountPersonId,
    });
    expect(result).toEqual({ ok: true, accountPersonId });

    const after = await resolveKinshipProjection(runtimeDb, account(steward.id), fam.id);
    expect(after.edges.some((e) => e.personAId === mentionPersonId || e.personBId === mentionPersonId)).toBe(
      false,
    );
    expect(after.edges.some((e) => e.personAId === accountPersonId || e.personBId === accountPersonId)).toBe(
      true,
    );
  });

  it("rejects a non-steward member", async () => {
    const { fam, mentionPersonId, accountPersonId } = await seed();
    authCtx = { kind: "account", personId: accountPersonId };

    const result = await reconcileMentionAction({
      familyId: fam.id,
      mentionPersonId,
      accountPersonId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/steward/i);
    }
  });
});
