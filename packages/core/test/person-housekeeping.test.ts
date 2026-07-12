/**
 * Regression tests for the provisional-Person housekeeping reaper (ADR-0016, issue #30).
 *
 * The load-bearing guarantee: the reaper deletes only `origin = 'invitee'` Persons whose invitation
 * was never accepted, and NEVER a `mention` (identified or placeholder) or a `self`. A `mention` is
 * an accountless, name-optional Person just like an abandoned invite — `origin` is the only thing
 * that tells them apart, so this test proves the reaper honours it.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createInvitation,
  reapUnacceptedInvitees,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** Steward + family with the steward as an active member (so they may invite). */
async function familyWithSteward() {
  const steward = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, "Esposito", steward.id);
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "steward" });
  return { steward, fam };
}

async function originOf(personId: string): Promise<string | undefined> {
  const [p] = await db
    .select({ origin: persons.origin })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return p?.origin;
}

async function personExists(personId: string): Promise<boolean> {
  const [p] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return p !== undefined;
}

/** Insert a `mention` Person directly (the kinship write path is a later slice). */
async function makeMention(
  db: Database,
  opts: { displayName: string | null; identified: boolean },
): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({
      displayName: opts.displayName,
      spokenName: opts.displayName, // null for a placeholder — both name fields move together
      origin: "mention",
      identified: opts.identified,
      accountId: null,
    })
    .returning({ id: persons.id });
  return p!.id;
}

describe("persons backfill defaults (ADR-0016)", () => {
  it("a plain Person is origin='self', identified=true", async () => {
    const p = await makePerson(db, "Marco");
    const [row] = await db
      .select({ origin: persons.origin, identified: persons.identified })
      .from(persons)
      .where(eq(persons.id, p.id))
      .limit(1);
    expect(row?.origin).toBe("self");
    expect(row?.identified).toBe(true);
  });
});

describe("reapUnacceptedInvitees", () => {
  it("reaps a never-accepted invite's provisional Person once it is past expiry", async () => {
    const { steward, fam } = await familyWithSteward();
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore Esposito",
    });
    expect(await originOf(inviteePersonId)).toBe("invitee");

    // Reap from a moment far past the invitation's TTL — the pending invite is now dead.
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const { reapedPersonIds } = await reapUnacceptedInvitees(db, future);

    expect(reapedPersonIds).toContain(inviteePersonId);
    expect(await personExists(inviteePersonId)).toBe(false);
    // The dead invitation is cleared too (FK to persons would otherwise dangle).
    const remaining = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.inviteePersonId, inviteePersonId));
    expect(remaining).toHaveLength(0);
    // The inviter (a self Person) is untouched.
    expect(await personExists(steward.id)).toBe(true);
  });

  it("does NOT reap a still-pending, unexpired invite", async () => {
    const { steward, fam } = await familyWithSteward();
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
    });

    // Reap 'now' — the invite is still live, so its provisional Person survives.
    const { reapedPersonIds } = await reapUnacceptedInvitees(db, new Date());

    expect(reapedPersonIds).not.toContain(inviteePersonId);
    expect(await personExists(inviteePersonId)).toBe(true);
  });

  it("NEVER reaps an identified `mention` (a deceased ancestor / named kin)", async () => {
    const mentionId = await makeMention(db, { displayName: "Nonna Giulia", identified: true });

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const { reapedPersonIds } = await reapUnacceptedInvitees(db, future);

    expect(reapedPersonIds).not.toContain(mentionId);
    expect(await personExists(mentionId)).toBe(true);
  });

  it("NEVER reaps a placeholder `mention` (an anonymous, nameless bridge node)", async () => {
    const placeholderId = await makeMention(db, { displayName: null, identified: false });

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const { reapedPersonIds } = await reapUnacceptedInvitees(db, future);

    expect(reapedPersonIds).not.toContain(placeholderId);
    expect(await personExists(placeholderId)).toBe(true);
  });

  it("reaps the dead invite while both kinds of `mention` and the inviter survive the same run", async () => {
    const { steward, fam } = await familyWithSteward();
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
    });
    const identifiedMention = await makeMention(db, { displayName: "Nonna Giulia", identified: true });
    const placeholderMention = await makeMention(db, { displayName: null, identified: false });

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const { reapedPersonIds } = await reapUnacceptedInvitees(db, future);

    expect(reapedPersonIds).toEqual([inviteePersonId]);
    expect(await personExists(inviteePersonId)).toBe(false);
    expect(await personExists(identifiedMention)).toBe(true);
    expect(await personExists(placeholderMention)).toBe(true);
    expect(await personExists(steward.id)).toBe(true);
  });
});
