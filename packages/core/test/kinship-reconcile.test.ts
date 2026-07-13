/**
 * Tests for `reconcileMentionIntoAccount` (ADR-0016 identity reconciliation).
 *
 * When someone named as kin (a `mention` person, carrying the tree edges) later signs up (a `self`
 * account person, carrying login + content), the family has TWO rows for one human. Reconciliation
 * merges the mention INTO the account, entirely ledger-native: it APPENDS the account's equivalent
 * of every visible mention edge and APPENDS a superseding `denied` row for each mention edge, so the
 * mention drops out of the projection. The `kinship_assertions` ledger is append-only (a DB trigger
 * blocks UPDATE/DELETE), so nothing is ever edited — the mention row is left as an inert tombstone.
 *
 * Gated to the family's Steward. All fixtures use PGlite (real Postgres).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { accounts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  addRelative,
  reconcileMentionIntoAccount,
  resolveKinshipProjection,
  type AuthContext,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

/** Make a Person that is a real `self` account (origin self + a linked accounts row via accountId). */
async function makeSelfPerson(name: string) {
  const p = await makePerson(db, name);
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `auth|${p.id}` })
    .returning();
  await db.update(persons).set({ origin: "self", accountId: acct!.id }).where(eq(persons.id, p.id));
  return p;
}

async function personSex(id: string): Promise<string | null> {
  const [row] = await db.select({ sex: persons.sex }).from(persons).where(eq(persons.id, id)).limit(1);
  return row!.sex;
}

/** The set of parent ids of `childId` in the family's VISIBLE projection. */
async function parentsOf(fam: string, viewer: string, childId: string): Promise<string[]> {
  const { edges } = await resolveKinshipProjection(db, account(viewer), fam);
  return edges
    .filter((e) => e.edgeType === "parent_of" && e.personBId === childId)
    .map((e) => e.personAId)
    .sort();
}

async function partnersOf(fam: string, viewer: string, personId: string): Promise<string[]> {
  const { edges } = await resolveKinshipProjection(db, account(viewer), fam);
  return edges
    .filter((e) => e.edgeType === "partnered_with" && (e.personAId === personId || e.personBId === personId))
    .map((e) => (e.personAId === personId ? e.personBId : e.personAId))
    .sort();
}

/**
 * A family whose steward is `steward`, holding a `mention` child with two mention parents (the
 * classic "someone tagged them in the tree" shape) plus an `account` person (the one who later
 * signed up). The steward asserts every edge.
 */
async function seedFamilyWithMentionChild() {
  const steward = await makeSelfPerson("Steward");
  const fam = await makeFamily(db, "Esposito", steward.id);
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });

  // A mention child with two parents, all added by the steward.
  const child = await addRelative(db, account(steward.id), {
    familyId: fam.id,
    relation: "child",
    displayName: "Mia",
    sex: "female",
  });
  const mentionChildId = child.createdPersonId!;
  // A second parent for the mention child (the steward is parent #1; add a partner as parent #2).
  const dad = await addRelative(db, account(steward.id), {
    familyId: fam.id,
    relation: "parent",
    displayName: "Dad",
    anchorPersonId: mentionChildId,
  });
  const dadId = dad.createdPersonId!;

  // The account person who is really Mia (signed up later).
  const acct = await makeSelfPerson("Mia Real");
  await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });

  return { steward, fam, mentionChildId, dadId, stewardId: steward.id, accountId: acct.id };
}

describe("reconcileMentionIntoAccount — auth", () => {
  it("rejects an anonymous caller, no writes", async () => {
    const { fam, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, { kind: "anonymous" }, {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("rejects a non-steward member, no writes", async () => {
    const { fam, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    // accountId is a member but NOT the steward.
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(accountId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/steward/i);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });
});

describe("reconcileMentionIntoAccount — cross-family person-scope guard (regression)", () => {
  it("refuses foreign persons and does NOT fire the sex carry (steward of X, ids belong to Y)", async () => {
    // Family X — the actor is its steward.
    const actor = await makeSelfPerson("Actor");
    const famX = await makeFamily(db, "Xavier", actor.id);
    await addMembership(db, { personId: actor.id, familyId: famX.id, role: "member" });

    // Family Y — the actor is only an ordinary member, NOT the steward.
    const yStewardPerson = await makeSelfPerson("YSteward");
    const famY = await makeFamily(db, "Yancey", yStewardPerson.id);
    await addMembership(db, { personId: yStewardPerson.id, familyId: famY.id, role: "member" });
    await addMembership(db, { personId: actor.id, familyId: famY.id, role: "member" });

    // In family Y: a mention child (sex known) + an account person (sex UNKNOWN so the carry WOULD fire).
    const yChild = await addRelative(db, account(yStewardPerson.id), {
      familyId: famY.id,
      relation: "child",
      displayName: "Yara",
      sex: "female",
    });
    const yMentionId = yChild.createdPersonId!;
    const yAccount = await makeSelfPerson("Yara Real");
    await addMembership(db, { personId: yAccount.id, familyId: famY.id, role: "member" });
    expect(await personSex(yAccount.id)).toBe("unknown"); // carry would fire if unguarded

    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(actor.id), {
      familyId: famX.id, // actor IS steward of X …
      mentionPersonId: yMentionId, // … but these ids belong to Y
      accountPersonId: yAccount.id,
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not part of this family/i);
    // The Y account's sex is UNCHANGED — no cross-family attribute write.
    expect(await personSex(yAccount.id)).toBe("unknown");
    // Zero new ledger rows appended.
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("refuses when only ONE of the two ids is out-of-family (account foreign)", async () => {
    // A well-formed reconcile in this family, but with a foreign ACCOUNT id.
    const { fam, stewardId, mentionChildId } = await seedFamilyWithMentionChild();
    const foreignAccount = await makeSelfPerson("Foreign");
    const foreignFam = await makeFamily(db, "Zed", foreignAccount.id);
    await addMembership(db, { personId: foreignAccount.id, familyId: foreignFam.id, role: "member" });

    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId, // in this family
      accountPersonId: foreignAccount.id, // NOT in this family
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/account person is not part of this family/i);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });
});

describe("reconcileMentionIntoAccount — validation guards", () => {
  it("refuses when the loser is not a `mention` (a real self), no writes", async () => {
    const { fam, stewardId, accountId } = await seedFamilyWithMentionChild();
    // accountId is origin=self — never mergeable away.
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: accountId, // a self, not a mention
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/mention/i);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("refuses when mention === account, no writes", async () => {
    const { fam, stewardId, mentionChildId } = await seedFamilyWithMentionChild();
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: mentionChildId,
    });
    expect(res.allowed).toBe(false);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("refuses when the account person does not exist, no writes", async () => {
    const { fam, stewardId, mentionChildId } = await seedFamilyWithMentionChild();
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.allowed).toBe(false);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("refuses a mention that carries an account (would orphan identity), no writes", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    // Pathological: give the mention an accountId. The guard must refuse.
    const [acct] = await db.insert(accounts).values({ authProviderUserId: `auth|orphan` }).returning();
    await db.update(persons).set({ accountId: acct!.id }).where(eq(persons.id, mentionChildId));
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });
});

describe("reconcileMentionIntoAccount — happy path (parent_of edges)", () => {
  it("moves the mention child's parent edges onto the account and denies the mention's own", async () => {
    const { fam, stewardId, mentionChildId, dadId, accountId } = await seedFamilyWithMentionChild();

    // Before: the mention child is child of both steward and dad; the account has no parents.
    expect(await parentsOf(fam.id, stewardId, mentionChildId)).toEqual([stewardId, dadId].sort());
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([]);

    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(true);
    // Two mention edges → two new asserted (account) edges + two denied (mention) edges.
    expect(res.assertedEdgeIds).toHaveLength(2);
    expect(res.deniedEdgeIds).toHaveLength(2);

    // After: the ACCOUNT is child of both parents; the mention has no visible edges.
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([stewardId, dadId].sort());
    expect(await parentsOf(fam.id, stewardId, mentionChildId)).toEqual([]);
    const { edges } = await resolveKinshipProjection(db, account(stewardId), fam.id);
    const mentionTouched = edges.some(
      (e) => e.personAId === mentionChildId || e.personBId === mentionChildId,
    );
    expect(mentionTouched).toBe(false);
  });

  it("is idempotent: a second run appends no new visible edges", async () => {
    const { fam, stewardId, mentionChildId, dadId, accountId } = await seedFamilyWithMentionChild();
    await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    const afterFirst = await resolveKinshipProjection(db, account(stewardId), fam.id);
    const ledgerAfterFirst = (await db.select().from(kinshipAssertions)).length;

    // A second run: the mention is now a tombstone with NO visible edges, so it is no longer
    // "part of this family" (not an active member, not in the projection) → the person-scope guard
    // rejects it. Either way, the invariant that matters is NO further writes / NO double-append.
    const res2 = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res2.allowed).toBe(false);

    const afterSecond = await resolveKinshipProjection(db, account(stewardId), fam.id);
    // No new ledger rows; same visible projection (parents of account unchanged).
    expect((await db.select().from(kinshipAssertions)).length).toBe(ledgerAfterFirst);
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([stewardId, dadId].sort());
    expect(afterSecond.edges.length).toBe(afterFirst.edges.length);
  });

  it("is deterministic across two identical fresh runs", async () => {
    const a = await seedFamilyWithMentionChild();
    const resA = await reconcileMentionIntoAccount(db, account(a.stewardId), {
      familyId: a.fam.id,
      mentionPersonId: a.mentionChildId,
      accountPersonId: a.accountId,
    });

    db = await createTestDatabase();
    const b = await seedFamilyWithMentionChild();
    const resB = await reconcileMentionIntoAccount(db, account(b.stewardId), {
      familyId: b.fam.id,
      mentionPersonId: b.mentionChildId,
      accountPersonId: b.accountId,
    });
    expect(resA.assertedEdgeIds!.length).toBe(resB.assertedEdgeIds!.length);
    expect(resA.deniedEdgeIds!.length).toBe(resB.deniedEdgeIds!.length);
  });
});

describe("reconcileMentionIntoAccount — partnered_with", () => {
  it("moves a mention's partner edge onto the account", async () => {
    const steward = await makeSelfPerson("Steward");
    const fam = await makeFamily(db, "Esposito", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });

    // A mention "Pat" who is partnered with X (another mention).
    const pat = await addRelative(db, account(steward.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "Pat",
    });
    const mentionId = pat.createdPersonId!;
    const x = await addRelative(db, account(steward.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "X",
      anchorPersonId: mentionId,
    });
    const xId = x.createdPersonId!;

    const acct = await makeSelfPerson("Pat Real");
    await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });

    // Before: mention Pat is partnered with steward and X.
    expect(await partnersOf(fam.id, steward.id, mentionId)).toEqual([steward.id, xId].sort());

    const res = await reconcileMentionIntoAccount(db, account(steward.id), {
      familyId: fam.id,
      mentionPersonId: mentionId,
      accountPersonId: acct.id,
    });
    expect(res.allowed).toBe(true);

    // After: the account Pat is partnered with steward and X; the mention has no visible partners.
    expect(await partnersOf(fam.id, steward.id, acct.id)).toEqual([steward.id, xId].sort());
    expect(await partnersOf(fam.id, steward.id, mentionId)).toEqual([]);
  });

  it("SKIPS a self-loop: a mention partnered with the account itself", async () => {
    const steward = await makeSelfPerson("Steward");
    const fam = await makeFamily(db, "Esposito", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });

    const acct = await makeSelfPerson("Real");
    await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });

    // A mention that is partnered with the ACCOUNT person directly.
    const dup = await addRelative(db, account(steward.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "Dup",
      anchorPersonId: acct.id,
    });
    const mentionId = dup.createdPersonId!;

    const res = await reconcileMentionIntoAccount(db, account(steward.id), {
      familyId: fam.id,
      mentionPersonId: mentionId,
      accountPersonId: acct.id,
    });
    expect(res.allowed).toBe(true);
    // The only mention edge (partner with the account) is a self-loop → skipped: no asserted edge…
    expect(res.assertedEdgeIds).toEqual([]);
    // …but the mention's own edge is still denied so it drops from the projection.
    expect(res.deniedEdgeIds).toHaveLength(1);

    // The account is NOT partnered with itself, and the mention has no visible partners.
    expect(await partnersOf(fam.id, steward.id, acct.id)).toEqual([]);
    expect(await partnersOf(fam.id, steward.id, mentionId)).toEqual([]);
  });
});

describe("reconcileMentionIntoAccount — carry sex", () => {
  it("fills the account's sex from the mention when the account's is unknown", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    // The account starts unknown; the mention child was seeded female.
    expect(await personSex(accountId)).toBe("unknown");
    expect(await personSex(mentionChildId)).toBe("female");

    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(true);
    expect(res.sexCarried).toBe(true);
    expect(await personSex(accountId)).toBe("female");
  });

  it("does NOT overwrite an account sex that is already set", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    await db.update(persons).set({ sex: "male" }).where(eq(persons.id, accountId));

    const res = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(true);
    expect(res.sexCarried).toBe(false);
    expect(await personSex(accountId)).toBe("male");
  });
});
