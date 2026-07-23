/**
 * Integration test for `listPersonBoundInviteTargetsAction` (#334).
 * Reproduces the person-bound Invite modal's "Couldn't load invite options" failure modes.
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
import { accounts, families, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { addMembership, addRelative, type AuthContext } from "@chronicle/core";
import { listPersonBoundInviteTargetsAction } from "@/app/hub/tree/person-invite-actions";

async function makeSelfPerson(name: string) {
  const [p] = await runtimeDb.insert(persons).values({ displayName: name }).returning();
  const [acct] = await runtimeDb
    .insert(accounts)
    .values({ authProviderUserId: `auth|${p!.id}` })
    .returning();
  await runtimeDb
    .update(persons)
    .set({ origin: "self", accountId: acct!.id, identified: true, lifeStatus: "living" })
    .where(eq(persons.id, p!.id));
  return p!;
}

async function makeFamily(name: string, stewardId: string) {
  const [fam] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: stewardId, stewardPersonId: stewardId })
    .returning();
  return fam!;
}

const account = (personId: string): AuthContext => ({ kind: "account", personId });

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("listPersonBoundInviteTargetsAction", () => {
  it("returns targets for an invitable tree-only relative (happy path)", async () => {
    const viewer = await makeSelfPerson("Sofia");
    const fam = await makeFamily("Boudreaux", viewer.id);
    await addMembership(runtimeDb, { personId: viewer.id, familyId: fam.id, role: "steward" });

    // Living mention/relative with kinship standing, no membership → invitable into Boudreaux.
    const child = await addRelative(runtimeDb, account(viewer.id), {
      familyId: fam.id,
      relation: "child",
      displayName: "Mateo",
    });
    const inviteeId = child.createdPersonId!;

    authCtx = { kind: "account", personId: viewer.id };
    const res = await listPersonBoundInviteTargetsAction(inviteeId);

    expect(res).toEqual({
      ok: true,
      data: {
        families: [{ id: fam.id, name: "Boudreaux", shortName: null }],
        seededFamilyId: fam.id,
        displayName: "Mateo",
        email: "",
        phone: "",
      },
    });
  });

  it("returns not-eligible when standing fails", async () => {
    const viewer = await makeSelfPerson("Sofia");
    const stranger = await makeSelfPerson("Stranger");
    const fam = await makeFamily("Boudreaux", viewer.id);
    await addMembership(runtimeDb, { personId: viewer.id, familyId: fam.id, role: "steward" });

    authCtx = { kind: "account", personId: viewer.id };
    const res = await listPersonBoundInviteTargetsAction(stranger.id);
    expect(res).toEqual({ ok: false, error: "not-eligible" });
  });

  it("returns unauthorized when signed out", async () => {
    authCtx = { kind: "anonymous" };
    const res = await listPersonBoundInviteTargetsAction("any");
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });

  it("cross-family gap: co-member in A is invitable into B (canonical Zach case)", async () => {
    const viewer = await makeSelfPerson("Sofia");
    const famA = await makeFamily("Boudreaux", viewer.id);
    const famB = await makeFamily("Carney", viewer.id);
    await addMembership(runtimeDb, { personId: viewer.id, familyId: famA.id, role: "steward" });
    await addMembership(runtimeDb, { personId: viewer.id, familyId: famB.id, role: "steward" });

    const zach = await makeSelfPerson("Zach");
    await addMembership(runtimeDb, { personId: zach.id, familyId: famA.id, role: "member" });

    authCtx = { kind: "account", personId: viewer.id };
    const res = await listPersonBoundInviteTargetsAction(zach.id);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.families).toEqual([{ id: famB.id, name: "Carney", shortName: null }]);
    expect(res.data.seededFamilyId).toBe(famB.id);
    expect(res.data.displayName).toBe("Zach");
  });

  it("returns empty families (not loadError) when invitee is already in every viewer family", async () => {
    const viewer = await makeSelfPerson("Sofia");
    const fam = await makeFamily("Boudreaux", viewer.id);
    await addMembership(runtimeDb, { personId: viewer.id, familyId: fam.id, role: "steward" });
    const marco = await makeSelfPerson("Marco");
    await addMembership(runtimeDb, { personId: marco.id, familyId: fam.id, role: "member" });

    authCtx = { kind: "account", personId: viewer.id };
    const res = await listPersonBoundInviteTargetsAction(marco.id);

    expect(res).toEqual({
      ok: true,
      data: {
        families: [],
        seededFamilyId: null,
        displayName: "Marco",
        email: "",
        phone: "",
      },
    });
  });
});
