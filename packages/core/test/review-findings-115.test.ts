/**
 * COLD-REVIEW demonstration tests for epic #115 — each test documents a suspected bug found
 * while reviewing the feature branch. Written by the reviewer; NOT part of the feature work.
 *
 *  1. Merge-on-collision (#117) deletes the LOSER invitation row unconditionally, even when the
 *     loser is a LIVE invite whose link was already delivered — killing a working durable link
 *     (violates the #116 invariant) whenever the email-matched invite wins over a live phone match.
 *  2. invitation_dismissals has FK invitation_id → invitations.id with ON DELETE NO ACTION
 *     (migration 0023), so the housekeeping reaper can no longer delete an expired invite that
 *     was ever dismissed — the whole reaper transaction aborts on the FK violation.
 *  3. Same FK breaks merge-on-collision itself when the loser invite carries a dismissal row.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createAccountWithPerson,
  createInvitation,
  dismissInvitationForAccount,
  getInvitationByToken,
  reapUnacceptedInvitees,
  ThrottleError,
} from "../src/index";
import { INVITE_THROTTLE_DESTINATION_LIMIT } from "../src/constants";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function familyWithSteward(name = "Esposito") {
  const steward = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, name, steward.id);
  await addMembership(db, {
    personId: steward.id,
    familyId: fam.id,
    role: "steward",
  });
  return { steward, fam };
}

describe("REVIEW #117: merge-on-collision vs live loser link", () => {
  it("a LIVE phone-matched invite's already-delivered link survives a merge it loses", async () => {
    const { steward, fam } = await familyWithSteward();
    // Invite 1: email only (live) → provisional A.
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    // Invite 2: phone only (live, link "already sent" by SMS) → provisional B.
    const phoneInvite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551234567",
    });
    // Re-invite with BOTH identifiers → collision. The email match wins (#117 rule); the live
    // phone invite is the loser and its row is deleted — the SMS link sent yesterday now 404s.
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551234567",
    });
    // The #116 durable-link promise says a LIVE link keeps working across re-invites.
    const view = await getInvitationByToken(db, phoneInvite.token);
    expect(view).not.toBeNull();
  });
});

describe("REVIEW #117: untrimmed email stored vs trimmed match key", () => {
  it("an invite created with an untrimmed email dedups against the trimmed re-invite", async () => {
    const { steward, fam } = await familyWithSteward();
    // Core trims for MATCHING (trimmedEmail) but stores input.inviteeEmail verbatim.
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: " sal@example.com ", // untrimmed — stored as-is
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    // Dedup should have refreshed the first invite, not minted a second provisional Person.
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.inviteePersonId).toBe(first.inviteePersonId);
  });
});

describe("REVIEW #105×#117: dedup defeats the destination throttle", () => {
  it("repeat re-invites to the SAME email never trip the per-destination send ceiling", async () => {
    const { steward, fam } = await familyWithSteward();
    // The #105 destination throttle counts invitation ROWS created in the window ("rows ≈
    // sends"). Dedup (#117) refreshes one row in place, so every re-invite — each of which
    // triggers a real email/SMS dispatch in the web layer — leaves the count at 1.
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    let throttled = false;
    for (let i = 0; i < INVITE_THROTTLE_DESTINATION_LIMIT + 5; i++) {
      try {
        await createInvitation(db, {
          familyId: fam.id,
          inviterPersonId: steward.id,
          inviteeName: "Sal",
          inviteeEmail: "sal@example.com",
        });
      } catch (err) {
        if (err instanceof ThrottleError) throttled = true;
      }
    }
    expect(throttled).toBe(true);
  });
});

describe("REVIEW #120: invitation_dismissals FK (NO ACTION) vs deletion paths", () => {
  it("the reaper can delete an expired invite that was previously dismissed", async () => {
    const { steward, fam } = await familyWithSteward();
    const invite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: 1, // expires ~immediately
    });
    const { accountId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: `user_${Math.random()}`,
      email: "sal@example.com",
      emailVerified: true,
      displayName: "Sal",
    });
    // The account says "Not me" while the invite is live → dismissal row exists.
    await dismissInvitationForAccount(db, {
      invitationId: invite.invitationId,
      accountId,
    });
    await new Promise((r) => setTimeout(r, 5));
    // The invite dies unaccepted → the reaper must reclaim it (and its provisional Person).
    const result = await reapUnacceptedInvitees(db);
    expect(result.reapedPersonIds).toContain(invite.inviteePersonId);
    const leftover = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.id, invite.invitationId));
    expect(leftover).toHaveLength(0);
  });

  it("merge-on-collision can delete a loser invite that was previously dismissed", async () => {
    const { steward, fam } = await familyWithSteward();
    // Invite 1: email only → provisional A.
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    // Invite 2: phone only → provisional B; the phone's real owner dismisses the surfaced card.
    const phoneInvite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551234567",
    });
    const { accountId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: `user_${Math.random()}`,
      email: "other@example.com",
      emailVerified: true,
      phone: "+15551234567",
      phoneVerified: true,
      displayName: "Sal",
    });
    await dismissInvitationForAccount(db, {
      invitationId: phoneInvite.invitationId,
      accountId,
    });
    // Re-invite with both identifiers → merge deletes the dismissed loser invite.
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Sal",
        inviteeEmail: "sal@example.com",
        inviteePhone: "+15551234567",
      }),
    ).resolves.toBeTruthy();
  });
});
