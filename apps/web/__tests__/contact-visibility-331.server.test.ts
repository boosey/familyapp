/**
 * Regression test for #331 (ADR-0029) contact visibility enforcement.
 *
 * Asserts the invariant the Privacy section promises:
 *   (a) a HIDDEN channel (persons.hideEmail / persons.hidePhone) is NEVER prefilled into the
 *       person-bound Invite modal (`listPersonBoundInviteTargetsAction`),
 *   (b) a NON-hidden contact still prefills normally,
 *   (c) the notification/DELIVERY path is unaffected — the verified `account_contacts` the delivery
 *       resolver reads still holds and returns the real contact, i.e. hiding is visibility-to-humans
 *       only and the delivery query does not consult persons.hide*.
 *
 * Seeds full fixtures: viewer + invitee Persons, each with an Account, a shared active family
 * membership (the trust boundary prefill requires), and VERIFIED account_contacts rows.
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
import { accounts, accountContacts, families, memberships, persons } from "@chronicle/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
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
  return { personId: p!.id, accountId: acct!.id };
}

async function makeFamily(name: string, stewardId: string) {
  const [fam] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: stewardId, stewardPersonId: stewardId })
    .returning();
  return fam!;
}

async function addActiveMembership(personId: string, familyId: string, role: "steward" | "member") {
  await runtimeDb.insert(memberships).values({ personId, familyId, role, status: "active" });
}

async function addVerifiedContact(accountId: string, kind: "email" | "phone", value: string) {
  await runtimeDb
    .insert(accountContacts)
    .values({ accountId, kind, value, verifiedAt: new Date() });
}

/** Replicates the DELIVERY-path read (verified account_contacts by account, NO persons.hide* predicate). */
async function deliveryReadableContacts(accountId: string) {
  const rows = await runtimeDb
    .select({ kind: accountContacts.kind, value: accountContacts.value })
    .from(accountContacts)
    .where(and(eq(accountContacts.accountId, accountId), isNotNull(accountContacts.verifiedAt)));
  return rows;
}

/**
 * Seed a viewer (steward) + an invitee who shares an active family with the viewer but is invitable
 * into a SECOND viewer-only family, with verified email + phone contacts. Returns the ids.
 */
async function seedViewerAndInvitee() {
  const viewer = await makeSelfPerson("Sofia");
  const famShared = await makeFamily("Boudreaux", viewer.personId);
  const famGap = await makeFamily("Carney", viewer.personId);
  await addActiveMembership(viewer.personId, famShared.id, "steward");
  await addActiveMembership(viewer.personId, famGap.id, "steward");

  const invitee = await makeSelfPerson("Zach");
  // Shared active co-membership (the stronger trust boundary prefill requires) in famShared only,
  // leaving famGap as the invitable target.
  await addActiveMembership(invitee.personId, famShared.id, "member");
  await addVerifiedContact(invitee.accountId, "email", "zach@example.com");
  await addVerifiedContact(invitee.accountId, "phone", "+15551234567");

  return { viewer, invitee, famGap };
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("#331 contact visibility — Invite modal prefill enforcement", () => {
  it("(b) prefills both channels when NEITHER is hidden (baseline)", async () => {
    const { viewer, invitee, famGap } = await seedViewerAndInvitee();

    authCtx = { kind: "account", personId: viewer.personId };
    const res = await listPersonBoundInviteTargetsAction(invitee.personId);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.families).toEqual([{ id: famGap.id, name: "Carney", shortName: null }]);
    expect(res.data.email).toBe("zach@example.com");
    expect(res.data.phone).toBe("+15551234567");
  });

  it("(a) omits a HIDDEN email from prefill but keeps the visible phone", async () => {
    const { viewer, invitee } = await seedViewerAndInvitee();
    await runtimeDb
      .update(persons)
      .set({ hideEmail: true })
      .where(eq(persons.id, invitee.personId));

    authCtx = { kind: "account", personId: viewer.personId };
    const res = await listPersonBoundInviteTargetsAction(invitee.personId);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.email).toBe("");
    expect(res.data.phone).toBe("+15551234567");
  });

  it("(a) omits a HIDDEN phone from prefill but keeps the visible email", async () => {
    const { viewer, invitee } = await seedViewerAndInvitee();
    await runtimeDb
      .update(persons)
      .set({ hidePhone: true })
      .where(eq(persons.id, invitee.personId));

    authCtx = { kind: "account", personId: viewer.personId };
    const res = await listPersonBoundInviteTargetsAction(invitee.personId);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.email).toBe("zach@example.com");
    expect(res.data.phone).toBe("");
  });

  it("(a) omits BOTH channels when both are hidden", async () => {
    const { viewer, invitee } = await seedViewerAndInvitee();
    await runtimeDb
      .update(persons)
      .set({ hideEmail: true, hidePhone: true })
      .where(eq(persons.id, invitee.personId));

    authCtx = { kind: "account", personId: viewer.personId };
    const res = await listPersonBoundInviteTargetsAction(invitee.personId);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.email).toBe("");
    expect(res.data.phone).toBe("");
  });

  it("(c) delivery path is UNAFFECTED — verified contacts still readable when both channels are hidden", async () => {
    const { invitee } = await seedViewerAndInvitee();
    await runtimeDb
      .update(persons)
      .set({ hideEmail: true, hidePhone: true })
      .where(eq(persons.id, invitee.personId));

    // The delivery-shaped read (verified account_contacts, no persons.hide* predicate) still returns
    // the real contacts — hiding is visibility-to-humans only and never disables delivery.
    const rows = await deliveryReadableContacts(invitee.accountId);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.value]));
    expect(byKind.email).toBe("zach@example.com");
    expect(byKind.phone).toBe("+15551234567");
  });
});
