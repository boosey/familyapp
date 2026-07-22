/**
 * #334 (ADR-0028/#332 shared helper) — `resolveInviteStatuses`, the batch invite-status resolver
 * extracted out of `resolveKinshipTree` so a SECOND consumer (List's `loadFamilyTabData`, #334) can
 * hydrate a real `inviteStatus` for people who are NOT materialized in any tree window, without
 * duplicating the pending-invite / membership-gap batch queries. `resolveKinshipTree`'s own truth
 * table (`kinship-tree-invite-status.test.ts`) already covers the underlying rule exhaustively; this
 * file targets the extraction itself — calling the helper directly for subjects with no tree/edge
 * presence at all.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations } from "@chronicle/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createAccountWithPerson,
  resolveInviteStatuses,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("resolveInviteStatuses", () => {
  it("returns an empty map for an empty subject list without querying anything", async () => {
    const viewer = await makePerson(db, "Viewer");
    const fam = await makeFamily(db, "Fam", viewer.id);
    const statuses = await resolveInviteStatuses(db, viewer.id, fam.id, []);
    expect(statuses.size).toBe(0);
  });

  it("resolves invitable for a person with a membership gap who has NO kinship edge at all (#334 — List's off-window case)", async () => {
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Boudreaux", viewer.id);
    const famB = await makeFamily(db, "Carney", viewer.id);
    await addMembership(db, { personId: viewer.id, familyId: famA.id, role: "steward" });
    await addMembership(db, { personId: viewer.id, familyId: famB.id, role: "steward" });

    // Unplaced member of famA: an active member, but no kinship edge anywhere — the case
    // `resolveKinshipTree`'s window never sees, since it walks edges, not memberships.
    const unplaced = await makePerson(db, "Unplaced Uncle");
    await addMembership(db, { personId: unplaced.id, familyId: famA.id, role: "member" });

    const statuses = await resolveInviteStatuses(db, viewer.id, famA.id, [
      { personId: unplaced.id, identified: true, lifeStatus: "living", hasAccount: false },
    ]);
    expect(statuses.get(unplaced.id)).toBe("invitable");
  });

  it("resolves accepted (compat) for an account-holder with no membership gap", async () => {
    const viewer = await makePerson(db, "Viewer");
    const fam = await makeFamily(db, "Fam", viewer.id);
    await addMembership(db, { personId: viewer.id, familyId: fam.id, role: "steward" });
    const { personId: holderId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:holder",
      provider: "clerk",
      emailVerified: true,
      email: "holder@example.com",
      displayName: "Holder",
    });
    await addMembership(db, { personId: holderId, familyId: fam.id, role: "member" });

    const statuses = await resolveInviteStatuses(db, viewer.id, fam.id, [
      { personId: holderId, identified: true, lifeStatus: "living", hasAccount: true },
    ]);
    expect(statuses.get(holderId)).toBe("accepted");
  });

  it("scopes a live pending invite to the given familyId, not the subject's other families", async () => {
    const viewer = await makePerson(db, "Viewer");
    const famX = await makeFamily(db, "FamX", viewer.id);
    const famY = await makeFamily(db, "FamY", viewer.id);
    await addMembership(db, { personId: viewer.id, familyId: famX.id, role: "steward" });
    await addMembership(db, { personId: viewer.id, familyId: famY.id, role: "steward" });
    const subject = await makePerson(db, "Subject");
    // Subject is an active member of BOTH families the viewer belongs to — no membership gap in
    // EITHER family, isolating this test to the pending-invite scoping rule alone.
    await addMembership(db, { personId: subject.id, familyId: famX.id, role: "member" });
    await addMembership(db, { personId: subject.id, familyId: famY.id, role: "member" });
    await db.insert(invitations).values({
      tokenHash: "hash-x",
      familyId: famX.id,
      inviterPersonId: viewer.id,
      inviteePersonId: subject.id,
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const input = [
      { personId: subject.id, identified: true, lifeStatus: "living" as const, hasAccount: false },
    ];
    const statusesInX = await resolveInviteStatuses(db, viewer.id, famX.id, input);
    const statusesInY = await resolveInviteStatuses(db, viewer.id, famY.id, input);
    expect(statusesInX.get(subject.id)).toBe("pending");
    // No live invite scoped to famY and no membership gap → not-applicable (no account either).
    expect(statusesInY.get(subject.id)).toBe("not-applicable");
  });

  it("not-applicable for an unidentified or deceased subject regardless of a membership gap", async () => {
    const viewer = await makePerson(db, "Viewer");
    const famA = await makeFamily(db, "FamA", viewer.id);
    const famB = await makeFamily(db, "FamB", viewer.id);
    await addMembership(db, { personId: viewer.id, familyId: famA.id, role: "steward" });
    await addMembership(db, { personId: viewer.id, familyId: famB.id, role: "steward" });
    const deceased = await makePerson(db, "Deceased");

    const statuses = await resolveInviteStatuses(db, viewer.id, famA.id, [
      { personId: deceased.id, identified: true, lifeStatus: "deceased", hasAccount: false },
    ]);
    expect(statuses.get(deceased.id)).toBe("not-applicable");
  });
});
