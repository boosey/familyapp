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
  linkExistingMember,
  reconcileMentionIntoAccount,
  resolveKinshipProjection,
  unreconcileMention,
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

/**
 * A canonical, order-stable fingerprint of a family's VISIBLE kinship projection: one string per
 * edge (`parent_of` keeps direction; `partnered_with` endpoints are sorted so A|B == B|A), sorted.
 * Two projections are equal iff their fingerprints are equal — the round-trip oracle for un-reconcile.
 */
async function projectionFingerprint(fam: string, viewer: string): Promise<string[]> {
  const { edges } = await resolveKinshipProjection(db, account(viewer), fam);
  return edges
    .map((e) => {
      const [a, b] =
        e.edgeType === "partnered_with"
          ? [e.personAId, e.personBId].sort()
          : [e.personAId, e.personBId];
      return `${e.edgeType}|${a}|${b}`;
    })
    .sort();
}

describe("unreconcileMention — auth & preconditions", () => {
  it("rejects a non-steward member, no writes", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    const before = (await db.select().from(kinshipAssertions)).length;
    // accountId is a member but NOT the steward.
    const res = await unreconcileMention(db, account(accountId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/steward/i);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });

  it("refuses when there is no reconciliation to reverse for this mention, no writes", async () => {
    // A mention that was never reconciled.
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    const before = (await db.select().from(kinshipAssertions)).length;
    const res = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/no reconciliation/i);
    expect((await db.select().from(kinshipAssertions)).length).toBe(before);
  });
});

describe("unreconcileMention — round trip restores the exact pre-reconcile projection", () => {
  it("parent_of: reconcile then un-reconcile is a no-op on the visible projection", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    const before = await projectionFingerprint(fam.id, stewardId);

    const fwd = await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(fwd.allowed).toBe(true);
    // Sanity: the projection actually changed (mention edges moved onto the account).
    expect(await projectionFingerprint(fam.id, stewardId)).not.toEqual(before);

    const rev = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(rev.allowed).toBe(true);
    expect(rev.restoredEdgeIds).toHaveLength(2); // both mention parent edges back
    expect(rev.deniedEdgeIds).toHaveLength(2); // both redirected account edges removed

    // The mention is child of both parents again; the account has no parents again.
    expect(await projectionFingerprint(fam.id, stewardId)).toEqual(before);
  });

  it("partnered_with: reconcile then un-reconcile restores the mention's partners", async () => {
    const steward = await makeSelfPerson("Steward");
    const fam = await makeFamily(db, "Esposito", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });
    const pat = await addRelative(db, account(steward.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "Pat",
    });
    const mentionId = pat.createdPersonId!;
    await addRelative(db, account(steward.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "X",
      anchorPersonId: mentionId,
    });
    const acct = await makeSelfPerson("Pat Real");
    await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });
    const before = await projectionFingerprint(fam.id, steward.id);

    await reconcileMentionIntoAccount(db, account(steward.id), {
      familyId: fam.id,
      mentionPersonId: mentionId,
      accountPersonId: acct.id,
    });
    const rev = await unreconcileMention(db, account(steward.id), {
      familyId: fam.id,
      mentionPersonId: mentionId,
      accountPersonId: acct.id,
    });
    expect(rev.allowed).toBe(true);
    expect(await projectionFingerprint(fam.id, steward.id)).toEqual(before);
  });

  it("is idempotent: a second un-reconcile is a no-op with no new visible edges", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    const fp = await projectionFingerprint(fam.id, stewardId);

    const again = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(again.allowed).toBe(true);
    expect(again.restoredEdgeIds).toEqual([]);
    expect(again.deniedEdgeIds).toEqual([]);
    expect(await projectionFingerprint(fam.id, stewardId)).toEqual(fp);
  });
});

describe("unreconcileMention — preserves a pre-existing duplicate account edge", () => {
  it("does NOT deny an account edge that pre-existed the reconcile (only forward-created ones)", async () => {
    // Mia (mention) is child of steward + dad. BEFORE reconcile, the ACCOUNT is ALSO a child of the
    // steward — a genuine pre-existing duplicate. The forward reconcile's idempotency SKIPS re-adding
    // the steward→account edge (it already exists) and only appends steward-nothing / dad→account.
    // Un-reconcile must restore the mention's two edges but deny ONLY the forward-created dad→account
    // edge — never the pre-existing steward→account one.
    const { fam, stewardId, mentionChildId, dadId, accountId } = await seedFamilyWithMentionChild();
    // Pre-existing: account is already a child of the steward (link the existing member into the tree).
    await linkExistingMember(db, account(stewardId), {
      familyId: fam.id,
      relation: "child",
      anchorPersonId: stewardId,
      existingPersonId: accountId,
    });
    const before = await projectionFingerprint(fam.id, stewardId);
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([stewardId]);

    await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    // After reconcile the account has BOTH parents (steward pre-existing + dad redirected).
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([stewardId, dadId].sort());

    const rev = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(rev.allowed).toBe(true);
    // Only the forward-created dad→account edge is denied; the pre-existing steward→account survives.
    expect(await parentsOf(fam.id, stewardId, accountId)).toEqual([stewardId]);
    // The mention is fully restored.
    expect(await parentsOf(fam.id, stewardId, mentionChildId)).toEqual([stewardId, dadId].sort());
    expect(await projectionFingerprint(fam.id, stewardId)).toEqual(before);
  });
});

/**
 * Two distinct mentions M1 and M2 BOTH partnered with the same third party X, BOTH reconciled into the
 * same account A. The forward idempotency-skip means the shared `partnered_with(A, X)` edge is created
 * once (by whichever reconcile ran first) and carries a single redirect marker. Regression for the
 * corruption where un-reconciling ONE mention severed the OTHER's still-active shared edge.
 */
async function seedTwoMentionsSharingPartnerIntoOneAccount() {
  const steward = await makeSelfPerson("Steward");
  const fam = await makeFamily(db, "Esposito", steward.id);
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });

  const x = await addRelative(db, account(steward.id), {
    familyId: fam.id,
    relation: "partner",
    displayName: "X",
  });
  const xId = x.createdPersonId!;
  const m1 = await addRelative(db, account(steward.id), {
    familyId: fam.id,
    relation: "partner",
    displayName: "M1",
    anchorPersonId: xId,
  });
  const m1Id = m1.createdPersonId!;
  const m2 = await addRelative(db, account(steward.id), {
    familyId: fam.id,
    relation: "partner",
    displayName: "M2",
    anchorPersonId: xId,
  });
  const m2Id = m2.createdPersonId!;
  const acct = await makeSelfPerson("A Real");
  await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });

  const s = steward.id;
  // Merge BOTH mentions into the one account. Order: M1 first (creates A↔X), then M2 (idempotency-skip).
  await reconcileMentionIntoAccount(db, account(s), {
    familyId: fam.id,
    mentionPersonId: m1Id,
    accountPersonId: acct.id,
  });
  await reconcileMentionIntoAccount(db, account(s), {
    familyId: fam.id,
    mentionPersonId: m2Id,
    accountPersonId: acct.id,
  });
  // After both: the account is partnered with X (via the shared redirected edge).
  expect(await partnersOf(fam.id, s, acct.id)).toEqual([xId]);
  return { fam, stewardId: s, m1Id, m2Id, xId, accountId: acct.id };
}

describe("unreconcileMention — two mentions merged into one account share a redirect target", () => {
  it("un-reconciling the FIRST mention preserves the shared account edge the SECOND still relies on", async () => {
    const { fam, stewardId, m1Id, m2Id, xId, accountId } =
      await seedTwoMentionsSharingPartnerIntoOneAccount();

    const rev1 = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: m1Id,
      accountPersonId: accountId,
    });
    expect(rev1.allowed).toBe(true);
    // M1's own partnership is back; M2 is still merged, so the account KEEPS its partnership with X.
    expect(await partnersOf(fam.id, stewardId, m1Id)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, accountId)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, m2Id)).toEqual([]); // still tombstoned

    // Now release the second: with no mention left relying on it, the account edge is removed.
    const rev2 = await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: m2Id,
      accountPersonId: accountId,
    });
    expect(rev2.allowed).toBe(true);
    expect(await partnersOf(fam.id, stewardId, m2Id)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, accountId)).toEqual([]);
  });

  it("is order-independent: un-reconciling the SECOND mention first also preserves the shared edge", async () => {
    const { fam, stewardId, m1Id, m2Id, xId, accountId } =
      await seedTwoMentionsSharingPartnerIntoOneAccount();

    // Reverse the OTHER order (M2 first). M1 is still merged → account keeps X.
    await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: m2Id,
      accountPersonId: accountId,
    });
    expect(await partnersOf(fam.id, stewardId, m2Id)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, accountId)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, m1Id)).toEqual([]);

    await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: m1Id,
      accountPersonId: accountId,
    });
    expect(await partnersOf(fam.id, stewardId, m1Id)).toEqual([xId]);
    expect(await partnersOf(fam.id, stewardId, accountId)).toEqual([]);
  });
});

describe("unreconcileMention — parent_of direction: opposite-role mentions sharing a third party", () => {
  it("removes a redirected parent_of edge even when an opposite-role mention into the same account shares the third party", async () => {
    // M1 is a PARENT of X → parent_of(M1, X). M2 is a CHILD of X → parent_of(X, M2). Both merged into
    // account A. Un-reconciling M1 must remove parent_of(A, X) — M2's edge redirects to the REVERSED
    // parent_of(X, A), a different logical edge, so it does NOT keep parent_of(A, X) alive.
    const steward = await makeSelfPerson("Steward");
    const fam = await makeFamily(db, "Esposito", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });
    const s = steward.id;

    // X is a partner of the steward (no parent_of edge to X, so X's only parents come from the mentions).
    const x = await addRelative(db, account(s), {
      familyId: fam.id,
      relation: "partner",
      displayName: "X",
    });
    const xId = x.createdPersonId!;
    // M1 is a parent of X.
    const m1 = await addRelative(db, account(s), {
      familyId: fam.id,
      relation: "parent",
      displayName: "M1",
      anchorPersonId: xId,
    });
    const m1Id = m1.createdPersonId!;
    // M2 is a child of X.
    const m2 = await addRelative(db, account(s), {
      familyId: fam.id,
      relation: "child",
      displayName: "M2",
      anchorPersonId: xId,
    });
    const m2Id = m2.createdPersonId!;
    const acct = await makeSelfPerson("A Real");
    await addMembership(db, { personId: acct.id, familyId: fam.id, role: "member" });

    await reconcileMentionIntoAccount(db, account(s), {
      familyId: fam.id,
      mentionPersonId: m1Id,
      accountPersonId: acct.id,
    });
    await reconcileMentionIntoAccount(db, account(s), {
      familyId: fam.id,
      mentionPersonId: m2Id,
      accountPersonId: acct.id,
    });
    // After both: A is a parent of X (from M1) AND a child of X (from M2).
    expect(await parentsOf(fam.id, s, xId)).toEqual([acct.id]); // A is X's parent
    expect(await parentsOf(fam.id, s, acct.id)).toEqual([xId]); // X is A's parent

    // Un-reconcile M1 only. parent_of(A,X) is M1's alone → it MUST be removed (not held by M2's
    // reversed-role edge). parent_of(X,A) stays (M2 still merged).
    const rev = await unreconcileMention(db, account(s), {
      familyId: fam.id,
      mentionPersonId: m1Id,
      accountPersonId: acct.id,
    });
    expect(rev.allowed).toBe(true);
    // M1's own edge is restored AND A is no longer X's parent → X's only parent is M1 again.
    expect(await parentsOf(fam.id, s, xId)).toEqual([m1Id]);
    expect(await parentsOf(fam.id, s, acct.id)).toEqual([xId]); // X is STILL A's parent (M2 relies)
  });
});

describe("unreconcileMention — sex carry is one-way (not reversed in v1)", () => {
  it("leaves the carried sex on the account after un-reconcile", async () => {
    const { fam, stewardId, mentionChildId, accountId } = await seedFamilyWithMentionChild();
    expect(await personSex(accountId)).toBe("unknown");
    await reconcileMentionIntoAccount(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    expect(await personSex(accountId)).toBe("female"); // carried by forward

    await unreconcileMention(db, account(stewardId), {
      familyId: fam.id,
      mentionPersonId: mentionChildId,
      accountPersonId: accountId,
    });
    // Edges-only reversal: the carried sex is a one-way enrichment, deliberately NOT un-set.
    expect(await personSex(accountId)).toBe("female");
  });
});
