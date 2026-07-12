/**
 * Tests for the kinship SUBJECT-HIDE veto write surface (ADR-0016, issue #34): hideEdge / unhideEdge,
 * gated to a real `self` account that is an ENDPOINT of the edge. A hide overrides even a Steward
 * affirmation (read overlay). A `mention` endpoint (no account) cannot hide, and a non-endpoint
 * cannot hide on someone else's behalf.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { accounts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  addRelative,
  affirmEdge,
  hideEdge,
  normalizeEdgeEndpoints,
  resolveKinshipProjection,
  unhideEdge,
  type EdgeRef,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

/** Make a Person that is a real `self` account (origin self + a linked accounts row via accountId). */
async function makeSelfPerson(db: Database, displayName: string) {
  const p = await makePerson(db, displayName);
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `auth|${p.id}` })
    .returning();
  await db.update(persons).set({ origin: "self", accountId: acct!.id }).where(eq(persons.id, p.id));
  return p;
}

async function assertParentOf(
  db: Database,
  input: { familyId: string; parent: string; child: string; actor: string },
) {
  const { personAId, personBId } = normalizeEdgeEndpoints("parent_of", input.parent, input.child);
  await db.insert(kinshipAssertions).values({
    familyId: input.familyId,
    edgeType: "parent_of",
    personAId,
    personBId,
    nature: "biological",
    state: "asserted",
    actorPersonId: input.actor,
  });
}

async function familyWithStewardAndMember() {
  const steward = await makeSelfPerson(db, "Steward");
  const fam = await makeFamily(db, "Esposito", steward.id);
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });
  const member = await makeSelfPerson(db, "Member");
  await addMembership(db, { personId: member.id, familyId: fam.id, role: "member" });
  return { steward, member, fam };
}

describe("hideEdge / unhideEdge (#34)", () => {
  it("a self subject who is an endpoint hides the edge → suppressed in projection; unhide restores", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: member.id, actor: parent.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: member.id };

    const res = await hideEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(true);
    let proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(0);

    const un = await unhideEdge(db, account(member.id), ref);
    expect(un.allowed).toBe(true);
    proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(1);
  });

  it("hide overrides a prior steward affirm (precedence regression)", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: member.id, actor: parent.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: member.id };

    // Steward affirms first...
    await affirmEdge(db, account(steward.id), ref);
    // ...then the subject hides. Hide wins.
    await hideEdge(db, account(member.id), ref);

    const proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(0);
  });

  it("rejects a non-subject (someone who is not an endpoint) hiding on another's behalf", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };

    // Member is not an endpoint of this P→C edge → cannot hide it.
    const res = await hideEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(false);
    const proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(1); // not suppressed
  });

  it("rejects hiding when the subject endpoint is a mention (no account)", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    // Add a mention parent of `member`; the mention has no account, so the hide control is absent —
    // and even if invoked as the mention, it is rejected.
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Uncontactable Ancestor",
    });
    const mentionId = res.createdPersonId!;
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: mentionId, personBId: member.id };

    const hideRes = await hideEdge(db, account(mentionId), ref);
    expect(hideRes.allowed).toBe(false);
  });

  it("rejects an anonymous viewer", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: member.id, actor: parent.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: member.id };
    const res = await hideEdge(db, { kind: "anonymous" }, ref);
    expect(res.allowed).toBe(false);
  });

  it("rejects hiding a non-existent edge", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: member.id };
    const res = await hideEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(false);
  });
});
