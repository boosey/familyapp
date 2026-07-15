/**
 * Slice D (#6): the `inviteStatus` projection truth table on `resolveKinshipTree` (and the pure
 * `inviteStatusFor` rule it shares). Kinship/person metadata only — this reads persons + the
 * invitations ledger, never Story/Media, so it never widens the content front door.
 *
 * Rule (order matters):
 *   - `accepted`       — the person has an `accountId` (already a real user) — wins even over a
 *                        lingering pending row.
 *   - `pending`        — the person has a LIVE (`pending`, unexpired) invitation.
 *   - `invitable`      — identified, living, no account, no live invitation.
 *   - `not-applicable` — bridge/unidentified, deceased, or otherwise not invitable.
 *
 * Seeding goes through `resolveKinshipTree`: each subject is wired to the viewer/root by a `parent_of`
 * edge so it materializes in-window, then we assert the projected node's `inviteStatus`.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { invitations, persons } from "@chronicle/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createAccountWithPerson,
  createInvitation,
  inviteStatusFor,
  normalizeEdgeEndpoints,
  resolveKinshipTree,
  type KinshipTreeData,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

/** Insert a `parent_of` edge (root is the parent) so `child` materializes in the root's window. */
async function edgeRootParentOf(familyId: string, root: string, child: string) {
  const { personAId, personBId } = normalizeEdgeEndpoints("parent_of", root, child);
  await db.insert(kinshipAssertions).values({
    familyId,
    edgeType: "parent_of",
    personAId,
    personBId,
    nature: "biological",
    state: "asserted",
    actorPersonId: root,
  });
}

/** A family whose steward (the viewer/root) is an active member, so they may read + invite. */
async function familyWithViewer() {
  const viewer = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, "Esposito", viewer.id);
  await addMembership(db, { personId: viewer.id, familyId: fam.id, role: "steward" });
  return { viewer, fam };
}

function nodeStatus(tree: KinshipTreeData, id: string): string | undefined {
  return tree.nodes.find((n) => n.personId === id)?.inviteStatus;
}

describe("inviteStatusFor — pure rule", () => {
  it("accepted wins over a lingering pending invite", () => {
    expect(
      inviteStatusFor({
        accountId: "acct-1",
        identified: true,
        lifeStatus: "living",
        hasLivePendingInvite: true,
      }),
    ).toBe("accepted");
  });

  it("pending when a live invite exists and no account", () => {
    expect(
      inviteStatusFor({
        accountId: null,
        identified: true,
        lifeStatus: "living",
        hasLivePendingInvite: true,
      }),
    ).toBe("pending");
  });

  it("invitable when identified, living, no account, no live invite", () => {
    expect(
      inviteStatusFor({
        accountId: null,
        identified: true,
        lifeStatus: "living",
        hasLivePendingInvite: false,
      }),
    ).toBe("invitable");
  });

  it("not-applicable for an unidentified person", () => {
    expect(
      inviteStatusFor({
        accountId: null,
        identified: false,
        lifeStatus: "living",
        hasLivePendingInvite: false,
      }),
    ).toBe("not-applicable");
  });

  it("not-applicable for a deceased person", () => {
    expect(
      inviteStatusFor({
        accountId: null,
        identified: true,
        lifeStatus: "deceased",
        hasLivePendingInvite: false,
      }),
    ).toBe("not-applicable");
  });
});

describe("resolveKinshipTree — inviteStatus projection (truth table)", () => {
  it("account-holder → accepted", async () => {
    const { viewer, fam } = await familyWithViewer();
    // An account-backed person is already a real user.
    const { personId: holderId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:holder",
      email: "holder@example.com",
      displayName: "Marco Esposito",
    });
    await edgeRootParentOf(fam.id, viewer.id, holderId);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, holderId)).toBe("accepted");
  });

  it("live pending invitation → pending", async () => {
    const { viewer, fam } = await familyWithViewer();
    // createInvitation mints the provisional (Account-less) invitee Person and a live pending invite.
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: viewer.id,
      inviteeName: "Salvatore",
    });
    await edgeRootParentOf(fam.id, viewer.id, inviteePersonId);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, inviteePersonId)).toBe("pending");
  });

  it("identified living, no account, no invitation → invitable", async () => {
    const { viewer, fam } = await familyWithViewer();
    const p = await makePerson(db, "Giulia"); // identified + living by default, no account
    await edgeRootParentOf(fam.id, viewer.id, p.id);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, p.id)).toBe("invitable");
  });

  it("unidentified (bridge) person → not-applicable", async () => {
    const { viewer, fam } = await familyWithViewer();
    const [bridge] = await db
      .insert(persons)
      .values({ displayName: null, spokenName: null, identified: false })
      .returning();
    await edgeRootParentOf(fam.id, viewer.id, bridge!.id);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, bridge!.id)).toBe("not-applicable");
  });

  it("deceased person → not-applicable (even identified, no account)", async () => {
    const { viewer, fam } = await familyWithViewer();
    const [deceased] = await db
      .insert(persons)
      .values({
        displayName: "Nonno Vito",
        spokenName: "Vito",
        identified: true,
        lifeStatus: "deceased",
      })
      .returning();
    await edgeRootParentOf(fam.id, viewer.id, deceased!.id);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, deceased!.id)).toBe("not-applicable");
  });

  it("expired invitation on an otherwise-eligible person → invitable (not pending)", async () => {
    const { viewer, fam } = await familyWithViewer();
    const p = await makePerson(db, "Elena"); // identified, living, no account
    await edgeRootParentOf(fam.id, viewer.id, p.id);
    // A pending-status row whose expiry is already in the past is NOT a live invite.
    await db.insert(invitations).values({
      tokenHash: "expired-hash",
      familyId: fam.id,
      inviterPersonId: viewer.id,
      inviteePersonId: p.id,
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, p.id)).toBe("invitable");
  });

  it("scopes pending status by family — an invite into family X does not mark the person pending in family Y", async () => {
    // The same global Person is a member of / materialized in two families. A LIVE pending invitation
    // anchored to family X must NOT leak `pending` into family Y's tree (that would hide a legitimate
    // Invite affordance in Y). Scoped by `invitations.familyId`.
    const shared = await makePerson(db, "Chiara"); // identified, living, no account

    // Family X: viewerX invites `shared` — a live pending invite scoped to X.
    const { viewer: viewerX, fam: famX } = await familyWithViewer();
    await addMembership(db, { personId: shared.id, familyId: famX.id, role: "member" });
    await edgeRootParentOf(famX.id, viewerX.id, shared.id);
    await db.insert(invitations).values({
      tokenHash: "x-pending-hash",
      familyId: famX.id,
      inviterPersonId: viewerX.id,
      inviteePersonId: shared.id,
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Family Y: a DIFFERENT family, `shared` materialized, NO invite into Y.
    const { viewer: viewerY, fam: famY } = await familyWithViewer();
    await addMembership(db, { personId: shared.id, familyId: famY.id, role: "member" });
    await edgeRootParentOf(famY.id, viewerY.id, shared.id);

    const treeX = await resolveKinshipTree(db, account(viewerX.id), famX.id, viewerX.id);
    const treeY = await resolveKinshipTree(db, account(viewerY.id), famY.id, viewerY.id);
    expect(nodeStatus(treeX, shared.id)).toBe("pending"); // still pending in X
    expect(nodeStatus(treeY, shared.id)).toBe("invitable"); // NOT pending in Y
  });

  it("revoked invitation on an otherwise-eligible person → invitable (not pending)", async () => {
    const { viewer, fam } = await familyWithViewer();
    const p = await makePerson(db, "Luca");
    await edgeRootParentOf(fam.id, viewer.id, p.id);
    await db.insert(invitations).values({
      tokenHash: "revoked-hash",
      familyId: fam.id,
      inviterPersonId: viewer.id,
      inviteePersonId: p.id,
      status: "revoked",
      // Not expired — but revoked is not `pending`, so it is not a live invite.
      expiresAt: new Date(Date.now() + 60_000),
    });

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, p.id)).toBe("invitable");
  });
});
