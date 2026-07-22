/**
 * Slice D (#6) / #332 (ADR-0028): the `inviteStatus` projection truth table on `resolveKinshipTree`
 * (and the pure `inviteStatusFor` rule it shares). Kinship/person metadata only — this reads persons +
 * the invitations ledger + memberships, never Story/Media, so it never widens the content front door.
 *
 * Rule (order matters, #332 supersedes the Account-hides-Invite rule from Slice D):
 *   - `not-applicable` — bridge/unidentified, or deceased.
 *   - `pending`        — the person has a LIVE (`pending`, unexpired) invitation INTO THE BROWSED
 *                        family — wins even over a membership gap or account presence.
 *   - `invitable`      — the viewer has a MEMBERSHIP GAP for this person (≥1 of the viewer's active
 *                        families where the person is not an active member) — Account or not.
 *   - `accepted`       — the person has an `accountId` and NO membership gap (compat path: already a
 *                        member of every family the viewer belongs to). Retained for compatibility
 *                        until #335 retires it.
 *   - `not-applicable` — otherwise (no account, no gap — nothing left to invite into).
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

/**
 * Two families, one viewer active (steward) in BOTH — the setup for the canonical membership-gap
 * scenario (#332, ADR-0028): "Zach on Boudreaux → invitable into Carney". `hasMembershipGap` is
 * computed across ALL of the viewer's active families, not just the browsed one, so a gap in `famB`
 * can make a person `invitable` even while their tree node is materialized on `famA`.
 */
async function twoFamiliesForViewer() {
  const viewer = await makePerson(db, "Sofia Carney-Boudreaux");
  const famA = await makeFamily(db, "Boudreaux", viewer.id);
  const famB = await makeFamily(db, "Carney", viewer.id);
  await addMembership(db, { personId: viewer.id, familyId: famA.id, role: "steward" });
  await addMembership(db, { personId: viewer.id, familyId: famB.id, role: "steward" });
  return { viewer, famA, famB };
}

function nodeStatus(tree: KinshipTreeData, id: string): string | undefined {
  return tree.nodes.find((n) => n.personId === id)?.inviteStatus;
}

describe("inviteStatusFor — pure rule (membership-gap eligibility, ADR-0028 / #332)", () => {
  const base = {
    identified: true,
    lifeStatus: "living" as const,
    hasLivePendingInvite: false,
    hasAccount: false,
    hasMembershipGap: false,
  };

  it("invitable when an account-holder has a membership gap (canonical Zach → Carney)", () => {
    expect(
      inviteStatusFor({ ...base, hasAccount: true, hasMembershipGap: true }),
    ).toBe("invitable");
  });

  it("accepted (compat) when an account-holder has NO membership gap", () => {
    expect(
      inviteStatusFor({ ...base, hasAccount: true, hasMembershipGap: false }),
    ).toBe("accepted");
  });

  it("invitable when there is no account but a membership gap exists", () => {
    expect(
      inviteStatusFor({ ...base, hasAccount: false, hasMembershipGap: true }),
    ).toBe("invitable");
  });

  it("not-applicable when there is no account and no membership gap", () => {
    expect(
      inviteStatusFor({ ...base, hasAccount: false, hasMembershipGap: false }),
    ).toBe("not-applicable");
  });

  it("pending wins over a membership gap and account presence", () => {
    expect(
      inviteStatusFor({
        ...base,
        hasAccount: true,
        hasMembershipGap: true,
        hasLivePendingInvite: true,
      }),
    ).toBe("pending");
  });

  it("not-applicable for an unidentified person even with a membership gap", () => {
    expect(
      inviteStatusFor({ ...base, identified: false, hasMembershipGap: true }),
    ).toBe("not-applicable");
  });

  it("not-applicable for a deceased person even with a membership gap", () => {
    expect(
      inviteStatusFor({ ...base, lifeStatus: "deceased", hasMembershipGap: true }),
    ).toBe("not-applicable");
  });
});

describe("resolveKinshipTree — inviteStatus projection (truth table)", () => {
  it("account-holder → accepted (compat: no membership gap)", async () => {
    const { viewer, fam } = await familyWithViewer();
    // An account-backed person is already a real user AND already an active member of the (only)
    // family the viewer belongs to — no membership gap, so the compat `accepted` status applies.
    const { personId: holderId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:holder",
      provider: "clerk",
      emailVerified: true,
      email: "holder@example.com",
      displayName: "Marco Esposito",
    });
    await addMembership(db, { personId: holderId, familyId: fam.id, role: "member" });
    await edgeRootParentOf(fam.id, viewer.id, holderId);

    const tree = await resolveKinshipTree(db, account(viewer.id), fam.id, viewer.id);
    expect(nodeStatus(tree, holderId)).toBe("accepted");
  });

  it("account-holder on Family A is invitable when the viewer has a membership gap in Family B (canonical Zach → Carney, #332)", async () => {
    const { viewer, famA, famB } = await twoFamiliesForViewer();
    void famB; // establishes the viewer's second family — the gap Zach falls into
    // Zach is a real account-holder and an active member of famA (Boudreaux) — but NOT of famB
    // (Carney), where the viewer also holds active membership. That's a membership gap, so Zach is
    // `invitable` even though he's viewed here, on famA's tree, where he's already a member.
    const { personId: zachId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:zach",
      provider: "clerk",
      emailVerified: true,
      email: "zach@example.com",
      displayName: "Zach Boudreaux",
    });
    await addMembership(db, { personId: zachId, familyId: famA.id, role: "member" });
    await edgeRootParentOf(famA.id, viewer.id, zachId);

    const tree = await resolveKinshipTree(db, account(viewer.id), famA.id, viewer.id);
    expect(nodeStatus(tree, zachId)).toBe("invitable");
  });

  it("account-holder already an active member of ALL the viewer's families → accepted", async () => {
    const { viewer, famA, famB } = await twoFamiliesForViewer();
    const { personId: markId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:mark",
      provider: "clerk",
      emailVerified: true,
      email: "mark@example.com",
      displayName: "Mark Carney",
    });
    // No gap: Mark is an active member of BOTH families the viewer belongs to.
    await addMembership(db, { personId: markId, familyId: famA.id, role: "member" });
    await addMembership(db, { personId: markId, familyId: famB.id, role: "member" });
    await edgeRootParentOf(famA.id, viewer.id, markId);

    const tree = await resolveKinshipTree(db, account(viewer.id), famA.id, viewer.id);
    expect(nodeStatus(tree, markId)).toBe("accepted");
  });

  it("pending invite into the browsed family wins even when the viewer also has a gap elsewhere", async () => {
    const { viewer, famA } = await twoFamiliesForViewer();
    // No account; a live pending invite scoped to famA (the browsed family). The viewer ALSO has a
    // membership gap in famB (the invitee holds no membership there at all) — pending still wins.
    const { inviteePersonId } = await createInvitation(db, {
      familyId: famA.id,
      inviterPersonId: viewer.id,
      inviteeName: "Priya",
    });
    await edgeRootParentOf(famA.id, viewer.id, inviteePersonId);

    const tree = await resolveKinshipTree(db, account(viewer.id), famA.id, viewer.id);
    expect(nodeStatus(tree, inviteePersonId)).toBe("pending");
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
    // The same global Person is a member of family X and materialized (but NOT an active member) in
    // family Y. A LIVE pending invitation anchored to family X must NOT leak `pending` into family Y's
    // tree (that would hide a legitimate Invite affordance in Y). Scoped by `invitations.familyId`.
    // `shared` is not an active member of Y, so viewerY has a membership gap there too — `invitable`.
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

    // Family Y: a DIFFERENT family. `shared` is materialized on Y's tree via a kinship edge, but is
    // NOT an active member of Y — a membership gap for viewerY — and has NO invite into Y.
    const { viewer: viewerY, fam: famY } = await familyWithViewer();
    await edgeRootParentOf(famY.id, viewerY.id, shared.id);

    const treeX = await resolveKinshipTree(db, account(viewerX.id), famX.id, viewerX.id);
    const treeY = await resolveKinshipTree(db, account(viewerY.id), famY.id, viewerY.id);
    expect(nodeStatus(treeX, shared.id)).toBe("pending"); // still pending in X
    expect(nodeStatus(treeY, shared.id)).toBe("invitable"); // NOT pending in Y; gap → invitable
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
