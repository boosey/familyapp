/**
 * Server-side integration test for the pending-invite confirm actions (#120).
 *
 * The load-bearing property is the ALLOW-LIST check: both actions re-verify the invitation is
 * genuinely surfaced to the caller's own verified contacts before acting — otherwise any
 * logged-in user could join (or dismiss) an arbitrary pending invite by id.
 *
 * Harness mirrors share-family-picker.server.test.ts: `@/lib/runtime` is mocked so importing the
 * actions module doesn't boot the real DEV runtime; `redirect`/`revalidatePath` are stubbed.
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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations, memberships, persons } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import {
  addMembership,
  createAccountWithPerson,
  createInvitation,
  listPendingInvitationsForPerson,
} from "@chronicle/core";
import { families } from "@chronicle/db/schema";
import {
  dismissPendingInvite,
  joinPendingInvite,
} from "@/app/hub/pending-invites-actions";
import { hub } from "@/app/_copy";

function fd(invitationId: string): FormData {
  const f = new FormData();
  f.set("invitationId", invitationId);
  return f;
}

async function seedFamilyWithInvite(inviteeEmail: string) {
  const [steward] = await runtimeDb
    .insert(persons)
    .values({ displayName: "Rosa Esposito" })
    .returning({ id: persons.id });
  const [fam] = await runtimeDb
    .insert(families)
    .values({
      name: "Esposito",
      creatorPersonId: steward!.id,
      stewardPersonId: steward!.id,
    })
    .returning({ id: families.id });
  await addMembership(runtimeDb, {
    personId: steward!.id,
    familyId: fam!.id,
    role: "steward",
  });
  const invite = await createInvitation(runtimeDb, {
    familyId: fam!.id,
    inviterPersonId: steward!.id,
    inviteeName: "Sal",
    inviteeEmail,
  });
  return { familyId: fam!.id, invitationId: invite.invitationId };
}

async function seedAccountPerson(email: string) {
  return createAccountWithPerson(runtimeDb, {
    provider: "clerk",
    authProviderUserId: `user_${Math.random()}`,
    email,
    emailVerified: true,
    displayName: "Sal",
  });
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
});

describe("joinPendingInvite (#120)", () => {
  it("Join accepts the invite: membership created, invitation flipped to accepted", async () => {
    const { familyId, invitationId } = await seedFamilyWithInvite("sal@x.com");
    const { personId } = await seedAccountPerson("sal@x.com");
    authCtx = { kind: "account", personId };

    await expect(joinPendingInvite(fd(invitationId))).rejects.toThrow("REDIRECT:/hub");

    const [m] = await runtimeDb
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.familyId, familyId),
          eq(memberships.status, "active"),
        ),
      );
    expect(m).toBeTruthy();
    const [invite] = await runtimeDb
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invitationId));
    expect(invite?.status).toBe("accepted");
  });

  it("SECURITY: an invitation NOT surfaced to this account cannot be joined by id", async () => {
    const { invitationId } = await seedFamilyWithInvite("someone-else@x.com");
    const { personId } = await seedAccountPerson("sal@x.com");
    authCtx = { kind: "account", personId };

    await expect(joinPendingInvite(fd(invitationId))).rejects.toThrow(
      hub.pendingInvites.noLongerAvailable,
    );

    // No membership, invite still pending.
    const ms = await runtimeDb
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.personId, personId));
    expect(ms).toHaveLength(0);
    const [invite] = await runtimeDb
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invitationId));
    expect(invite?.status).toBe("pending");
  });
});

describe("dismissPendingInvite (#120)", () => {
  it("'Not me' hides the card for this account and leaves the invite pending", async () => {
    const { invitationId } = await seedFamilyWithInvite("sal@x.com");
    const { personId } = await seedAccountPerson("sal@x.com");
    authCtx = { kind: "account", personId };
    expect(await listPendingInvitationsForPerson(runtimeDb, personId)).toHaveLength(1);

    await dismissPendingInvite(fd(invitationId));

    expect(await listPendingInvitationsForPerson(runtimeDb, personId)).toHaveLength(0);
    const [invite] = await runtimeDb
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invitationId));
    expect(invite?.status).toBe("pending");
  });

  it("SECURITY: cannot dismiss an invitation not surfaced to this account", async () => {
    const { invitationId } = await seedFamilyWithInvite("someone-else@x.com");
    const { personId } = await seedAccountPerson("sal@x.com");
    authCtx = { kind: "account", personId };

    // No-op (not even an error): nothing was surfaced, nothing is dismissed.
    await dismissPendingInvite(fd(invitationId));
    expect(await listPendingInvitationsForPerson(runtimeDb, personId)).toHaveLength(0);
  });
});
