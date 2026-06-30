/**
 * Unit tests for the /auth/callback pure logic helpers.
 *
 * The cookie read/clear (next/headers) and the Clerk auth() call live in the route handler
 * itself and are not tested here — they are hard to exercise without a real request context.
 * Instead, we test:
 *   1. appendInviteParam — a fully pure string helper.
 *   2. resolveCallbackDestination — the DB-backed core logic, driven with a real PGlite
 *      instance (same discipline as auth-clerk.test.ts: we test the actual Drizzle path,
 *      not a mock that just looks plausible).
 *
 * next/headers is mocked because server-only modules that import it (post-auth-route via
 * listActiveMembershipsForPerson etc.) need the shim even though these tests don't set cookies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { families, memberships } from "@chronicle/db/schema";
import {
  createAccountWithPerson,
  createInvitation,
  listActiveMembershipsForPerson,
} from "@chronicle/core";
import { appendInviteParam, resolveCallbackDestination } from "../lib/auth-callback";

// In-memory cookie jar — mirrors auth-mock.test.ts sibling. Not used by these helpers directly
// but required because pending-invite imports next/headers at module load time (transitively).
let jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

beforeEach(() => {
  jar = new Map();
});

// ---------------------------------------------------------------------------
// appendInviteParam
// ---------------------------------------------------------------------------

describe("appendInviteParam", () => {
  it("appends ?from=invite to a plain path", () => {
    expect(appendInviteParam("/hub")).toBe("/hub?from=invite");
  });

  it("appends &from=invite when the path already has a query string", () => {
    expect(appendInviteParam("/families/find?pending=1")).toBe(
      "/families/find?pending=1&from=invite",
    );
  });

  it("appends ?from=invite to the root path", () => {
    expect(appendInviteParam("/")).toBe("/?from=invite");
  });

  it("appends &from=invite when query has multiple params", () => {
    expect(appendInviteParam("/page?a=1&b=2")).toBe("/page?a=1&b=2&from=invite");
  });
});

// ---------------------------------------------------------------------------
// resolveCallbackDestination
// ---------------------------------------------------------------------------

describe("resolveCallbackDestination", () => {
  it("routes an un-onboarded person to /welcome when no invite is present", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_test_001",
      email: "new@example.com",
      displayName: "New Person",
    });

    const dest = await resolveCallbackDestination(db, personId, null);
    expect(dest).toBe("/welcome");
  });

  it("still routes normally and logs a warning when the invite token is stale/invalid", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_test_002",
      email: "stale@example.com",
      displayName: "Stale Invite Person",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dest = await resolveCallbackDestination(db, personId, {
      token: "nonexistent-invite-token",
    });

    // A stale invite must NOT block the user — routing continues normally.
    expect(dest).toBe("/welcome");
    // The warning must be logged so the stale invite is not silently swallowed.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[auth/callback]"),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it("does not append ?from=invite when invite acceptance fails", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_test_003",
      email: "noappend@example.com",
      displayName: "No Append Person",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dest = await resolveCallbackDestination(db, personId, {
      token: "bad-token",
      relationshipLabel: "grandchild",
    });

    // Failed invite: bare destination, no ?from=invite
    expect(dest).not.toContain("from=invite");

    warnSpy.mockRestore();
  });

  it("routes to /welcome with no from=invite when there is no invite", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_test_004",
      email: "noinvite@example.com",
      displayName: "No Invite Person",
    });

    const dest = await resolveCallbackDestination(db, personId, null);
    expect(dest).toBe("/welcome");
    expect(dest).not.toContain("from=invite");
  });

  it("applies a VALID pending invite (membership created) and appends ?from=invite", async () => {
    const db = await createTestDatabase();

    // Inviter: an active member of a family who can issue an invitation.
    const { personId: inviterPersonId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_inviter",
      email: "inviter@example.com",
      displayName: "Sofia Inviter",
    });
    const [family] = await db
      .insert(families)
      .values({
        name: "Testfamily",
        creatorPersonId: inviterPersonId,
        stewardPersonId: inviterPersonId,
      })
      .returning({ id: families.id });
    await db.insert(memberships).values({
      personId: inviterPersonId,
      familyId: family!.id,
      role: "member",
      status: "active",
    });
    const { token } = await createInvitation(db, {
      familyId: family!.id,
      inviterPersonId,
      inviteeName: "New Grandchild",
      relationshipLabel: "from-the-invite-card",
    });

    // The just-provisioned invitee lands at the callback carrying the pending invite.
    const { personId: inviteePersonId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_invitee",
      email: "invitee@example.com",
      displayName: "New Grandchild",
    });

    const dest = await resolveCallbackDestination(db, inviteePersonId, {
      token,
      relationshipLabel: "granddaughter-typed-up-front",
    });

    // Un-onboarded invitee → /welcome, and the invite WAS applied → ?from=invite.
    expect(dest).toBe("/welcome?from=invite");

    // The membership must actually exist now (the accept really happened, not just routed).
    const mems = await listActiveMembershipsForPerson(db, inviteePersonId);
    expect(mems.map((m) => m.familyId)).toContain(family!.id);
  });
});
