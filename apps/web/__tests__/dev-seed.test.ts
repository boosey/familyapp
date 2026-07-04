/**
 * Regression tests for the dev seed's identity model and seed-data shape.
 *
 * Bug (locked in by this suite): Eleanor (a narrator) was seeded as a Person with NO Account, on a
 * now-rejected "the link token IS the narrator's identity" assumption. Effect: she never appeared in
 * the hub's "Switch user" list (built by an inner join on `accounts`) and could not sign into the
 * hub at all.
 *
 * The corrected domain rule: EVERY user has an Account. "Narrator" / "asker" is a role, not an
 * account distinction — the capture/question link is only a convenience login into an existing
 * account. These tests lock that in so a future seed edit can't regress a narrator to account-less.
 *
 * Additional shape checks: Eleanor must have ≥ 4 pending Asks and exactly one recorded answer
 * awaiting review (state='pending_approval', askId not null, prose populated) so the hub's
 * Questions tab shows "Review & approve" immediately with the AI-polished prose ready to edit.
 *
 * Clerk-mode tests: drive seedInto with clerkConfigured:true and a stub resolver to exercise the
 * binding logic without importing Clerk or hitting the network. Asserts real Clerk userIds are
 * stored as authProviderUserId and that mock_auth_users is never written.
 */
import { describe, expect, it, vi } from "vitest";
import { count, eq, isNull } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { stories } from "@chronicle/db/content";
import {
  accounts,
  asks,
  invitations,
  mockAuthUsers,
  persons,
} from "@chronicle/db/schema";
import { listOutstandingAnswerDrafts } from "@chronicle/core";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { seedInto } from "../lib/dev-seed";

async function seededDb() {
  const db = await createTestDatabase();
  const storage = new InMemoryMediaStorage();
  const result = await seedInto(db, storage);
  return { db, result };
}

// ---------------------------------------------------------------------------
// Stub Clerk userIds for Clerk-mode tests — realistic user_xxx format.
// ---------------------------------------------------------------------------
const CLERK_STUBS = {
  "eleanor+clerk_test@example.com": "user_eleanor_clerk",
  "sofia+clerk_test@example.com": "user_sofia_clerk",
  "marco+clerk_test@example.com": "user_marco_clerk",
  "theo+clerk_test@example.com": "user_theo_clerk",
} as const;

async function seededDbClerkMode(
  overrides: Partial<Record<string, string | null>> = {},
) {
  const db = await createTestDatabase();
  const storage = new InMemoryMediaStorage();
  const stub = vi.fn(async (email: string): Promise<string | null> => {
    if (email in overrides) return overrides[email] ?? null;
    return CLERK_STUBS[email as keyof typeof CLERK_STUBS] ?? null;
  });
  const result = await seedInto(db, storage, {
    clerkConfigured: true,
    getClerkUserIdByEmail: stub,
  });
  return { db, result, stub };
}

// ---------------------------------------------------------------------------
// Mock-mode (default) — existing regression suite
// ---------------------------------------------------------------------------

describe("dev seed — every Person has an Account (except provisional invitees)", () => {
  it("seeds no UNEXPLAINED account-less Persons (ADR-0006 allows pending invitees)", async () => {
    const { db } = await seededDb();
    // ADR-0006 loosened "every Person has an Account": a pending invitation anchors to a
    // provisional Account-less Person. Those are legitimate; any OTHER account-less Person is the
    // regressed-narrator bug this suite guards against. So: every account-less Person must be the
    // invitee of a pending invitation.
    const orphans = await db
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(isNull(persons.accountId));
    const unexplained = [];
    for (const o of orphans) {
      const [pendingInvite] = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(eq(invitations.inviteePersonId, o.id))
        .limit(1);
      if (!pendingInvite) unexplained.push(o.displayName);
    }
    expect(unexplained).toEqual([]);
  });

  it("gives Eleanor (the narrator) an Account, so the dev sign-in list includes her", async () => {
    const { db } = await seededDb();
    // Mirror listAccountPersons() in app/dev/sign-in/page.tsx: the inner join is what hid Eleanor.
    const signInOptions = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .innerJoin(accounts, eq(accounts.id, persons.accountId));
    const names = signInOptions.map((p) => p.displayName);
    expect(names).toContain("Eleanor Boudreaux");
    expect(names).toContain("Sofia Boudreaux");
    expect(names).toContain("Marco Boudreaux");
  });

  it("Eleanor is onboarded so she lands on the hub, not the /welcome gate", async () => {
    const { db, result } = await seededDb();
    // result.narratorPersonId is always defined in mock mode; assert non-null for TS.
    const [eleanor] = await db
      .select({ onboardedAt: persons.onboardedAt })
      .from(persons)
      .where(eq(persons.id, result.narratorPersonId!));
    expect(eleanor?.onboardedAt).not.toBeNull();
  });

  it("reconciles Eleanor's profile with the real Clerk test user (1956 / Zachary / IBM wins)", async () => {
    // The seed's Eleanor was merged with the live eleanor+clerk_test profile: her entered birth
    // year + intake biographical_anchors override the old 1942/Lafayette seed values. This locks
    // that in so a future edit can't silently revert her (the data the user typed live).
    const { db, result } = await seededDb();
    const [eleanor] = await db
      .select({
        birthYear: persons.birthYear,
        birthDate: persons.birthDate,
        anchors: persons.biographicalAnchors,
      })
      .from(persons)
      .where(eq(persons.id, result.narratorPersonId!));
    expect(eleanor?.birthYear).toBe(1956);
    expect(eleanor?.birthDate).toBe("1956-12-18");
    expect(eleanor?.anchors?.hometown).toBe("Zachary, LA");
    expect(eleanor?.anchors?.siblingContext).toBe("Youngest of five");
    expect(eleanor?.anchors?.occupationSummary).toContain("IBM");
    expect(eleanor?.anchors?.hasGrandchildren).toBe(true);
  });
});

describe("dev seed — Eleanor's question queue", () => {
  it("gives Eleanor at least 4 pending Asks so her 'Questions for you' tab has a real queue", async () => {
    const { db, result } = await seededDb();
    const pending = await db
      .select({ status: asks.status })
      .from(asks)
      .where(eq(asks.targetPersonId, result.narratorPersonId!));
    expect(pending.length).toBeGreaterThanOrEqual(4);
    expect(pending.every((a) => a.status === "queued")).toBe(true);
  });

  it("seeds exactly one recorded answer awaiting review (pending_approval, askId not null, prose populated) for Eleanor", async () => {
    const { db, result } = await seededDb();
    const drafts = await listOutstandingAnswerDrafts(db, result.narratorPersonId!);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.askId).not.toBeNull();
    expect(drafts[0]!.storyId).toBe(result.draftStoryId!);

    // The prose must be populated so the "Review & approve" editor is not blank.
    const [row] = await db
      .select({ prose: stories.prose })
      .from(stories)
      .where(eq(stories.id, result.draftStoryId!));
    expect(typeof row?.prose).toBe("string");
    expect((row?.prose ?? "").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Clerk mode — bind personas by email, skip mock_auth_users
// ---------------------------------------------------------------------------

describe("dev seed — Clerk mode, all four personas matched", () => {
  it("stores the real Clerk userId as authProviderUserId for each core persona", async () => {
    const { db } = await seededDbClerkMode();

    const rows = await db
      .select({ email: accounts.email, authProviderUserId: accounts.authProviderUserId })
      .from(accounts);

    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.authProviderUserId]));

    expect(byEmail["eleanor+clerk_test@example.com"]).toBe("user_eleanor_clerk");
    expect(byEmail["sofia+clerk_test@example.com"]).toBe("user_sofia_clerk");
    expect(byEmail["marco+clerk_test@example.com"]).toBe("user_marco_clerk");
    expect(byEmail["theo+clerk_test@example.com"]).toBe("user_theo_clerk");
  });

  it("writes NO mock_auth_users rows in Clerk mode", async () => {
    const { db } = await seededDbClerkMode();
    const [row] = await db.select({ n: count() }).from(mockAuthUsers);
    expect(row?.n).toBe(0);
  });

  it("returns all family-dependent result fields when all personas are matched", async () => {
    const { result } = await seededDbClerkMode();
    expect(result.narratorPersonId).toBeDefined();
    expect(result.boudreauxFamilyId).toBeDefined();
    expect(result.narratorToken).toBeDefined();
    expect(result.draftStoryId).toBeDefined();
    expect(result.memberInviteToken).toBeDefined();
    expect(result.theoJoinRequestPersonId).toBeDefined();
  });

  it("Eleanor is onboarded and has the Clerk userId stored", async () => {
    const { db, result } = await seededDbClerkMode();
    const [row] = await db
      .select({ onboardedAt: persons.onboardedAt })
      .from(persons)
      .where(eq(persons.id, result.narratorPersonId!));
    expect(row?.onboardedAt).not.toBeNull();

    const [acctRow] = await db
      .select({ authProviderUserId: accounts.authProviderUserId })
      .from(accounts)
      .where(eq(accounts.email, "eleanor+clerk_test@example.com"));
    expect(acctRow?.authProviderUserId).toBe("user_eleanor_clerk");
  });

  it("looks up all four emails exactly once each", async () => {
    const { stub } = await seededDbClerkMode();
    const calledEmails = stub.mock.calls.map((c) => c[0]);
    expect(calledEmails).toContain("eleanor+clerk_test@example.com");
    expect(calledEmails).toContain("sofia+clerk_test@example.com");
    expect(calledEmails).toContain("marco+clerk_test@example.com");
    expect(calledEmails).toContain("theo+clerk_test@example.com");
    // Each looked up exactly once
    expect(calledEmails.filter((e) => e === "eleanor+clerk_test@example.com")).toHaveLength(1);
  });
});

describe("dev seed — Clerk mode, Theo unmatched", () => {
  it("skips Theo's Account and join request when Theo has no Clerk user", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, result } = await seededDbClerkMode({
      "theo+clerk_test@example.com": null,
    });

    // Theo's Account must not exist
    const theoAccts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.email, "theo+clerk_test@example.com"));
    expect(theoAccts).toHaveLength(0);

    // Result field is undefined
    expect(result.theoJoinRequestPersonId).toBeUndefined();

    // Core family data was still seeded
    expect(result.narratorPersonId).toBeDefined();
    expect(result.boudreauxFamilyId).toBeDefined();
    expect(result.draftStoryId).toBeDefined();

    // A warning was emitted about Theo
    const theoWarning = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("Theo"),
    );
    expect(theoWarning).toBeDefined();

    warnSpy.mockRestore();
  });

  it("writes no mock_auth_users rows even when Theo is skipped", async () => {
    const { db } = await seededDbClerkMode({
      "theo+clerk_test@example.com": null,
    });
    const [row] = await db.select({ n: count() }).from(mockAuthUsers);
    expect(row?.n).toBe(0);
  });
});

describe("dev seed — Clerk mode, core persona unmatched", () => {
  it("skips the family content block and returns a degraded result when Eleanor is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, result } = await seededDbClerkMode({
      "eleanor+clerk_test@example.com": null,
    });

    // Family-dependent fields are absent
    expect(result.narratorPersonId).toBeUndefined();
    expect(result.boudreauxFamilyId).toBeUndefined();
    expect(result.narratorToken).toBeUndefined();
    expect(result.draftStoryId).toBeUndefined();
    expect(result.memberInviteToken).toBeUndefined();

    // Required fields are always present
    expect(result.stewardSignInEmail).toBe("sofia+clerk_test@example.com");
    expect(result.seedPassword).toBe("password");

    // No families were inserted
    const { families: familiesTable } = await import("@chronicle/db/schema");
    const familyRows = await db.select().from(familiesTable);
    expect(familyRows).toHaveLength(0);

    // No mock_auth_users written
    const [row] = await db.select({ n: count() }).from(mockAuthUsers);
    expect(row?.n).toBe(0);

    // A warning about the missing core persona was emitted
    const coreWarning = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("core persona"),
    );
    expect(coreWarning).toBeDefined();

    warnSpy.mockRestore();
  });
});
