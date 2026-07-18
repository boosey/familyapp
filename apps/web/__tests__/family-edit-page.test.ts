/**
 * /families/[id]/edit — steward-guard coverage (#54 AC: "tests cover the steward guard allow/deny").
 *
 * The RSC page + server action can't be rendered in vitest (same constraint as hub-guard.test.ts), so
 * we invoke the page default export and `updateFamilyAction` as plain async functions with two seams
 * mocked:
 *   1. `next/navigation` — both redirect(url) and notFound() throw a captured sentinel. redirect
 *      records the url (mimicking Next's NEXT_REDIRECT throw); notFound throws a distinct sentinel so
 *      the "no existence oracle" outcome (missing family AND non-steward both 404) is assertable apart
 *      from a /hub redirect.
 *   2. `@/lib/runtime` getRuntime() — real PGlite db + a controllable auth context.
 * Real identity-graph rows are seeded via createAccountWithPerson + createFamily.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { createAccountWithPerson, createFamily, getFamily } from "@chronicle/core";
import type { Database } from "@chronicle/db";

// ── Seams ────────────────────────────────────────────────────────────────────────────────────────
let lastRedirect: string | undefined;
let notFoundCalled = false;
class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    lastRedirect = url;
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  },
  notFound: () => {
    notFoundCalled = true;
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

let testDb: Database;
let ctxPersonId: string;
let ctxKind: "account" | "anonymous" = "account";
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: testDb,
    auth: {
      getCurrentAuthContext: async () =>
        ctxKind === "anonymous"
          ? { kind: "anonymous" as const }
          : { kind: "account" as const, personId: ctxPersonId },
    },
  }),
}));

// Import AFTER mocks so vi.mock hoisting applies.
import FamilyEditPage from "@/app/families/[id]/edit/page";
import { updateFamilyAction } from "@/app/families/[id]/edit/actions";

const RANDOM_UUID = "00000000-0000-0000-0000-000000000000";
const noError = Promise.resolve({} as { error?: string });

beforeEach(() => {
  lastRedirect = undefined;
  notFoundCalled = false;
  ctxKind = "account";
});

async function seedSteward(tag: string) {
  const { personId } = await createAccountWithPerson(testDb, {
    authProviderUserId: `edit-${tag}`,
    provider: "clerk",
    emailVerified: true,
    email: `edit-${tag}@example.test`,
    displayName: `Steward ${tag}`,
  });
  return personId;
}

describe("FamilyEditPage guard", () => {
  it("redirects an anonymous visitor to /sign-in", async () => {
    testDb = await createTestDatabase();
    ctxKind = "anonymous";

    await expect(
      FamilyEditPage({ params: Promise.resolve({ id: RANDOM_UUID }), searchParams: noError }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/sign-in");
  });

  it("returns notFound() for a malformed (non-UUID) id — before any DB query", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("malformed");

    await expect(
      FamilyEditPage({ params: Promise.resolve({ id: "not-a-uuid" }), searchParams: noError }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalled).toBe(true);
    // Same 404 as a missing family — no existence oracle, and no 500 from a uuid parse error.
    expect(lastRedirect).toBeUndefined();
  });

  it("returns notFound() for a missing family", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("missing");

    await expect(
      FamilyEditPage({ params: Promise.resolve({ id: RANDOM_UUID }), searchParams: noError }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalled).toBe(true);
    // No /hub redirect — the missing case is a 404, not a bounce.
    expect(lastRedirect).toBeUndefined();
  });

  it("returns notFound() for a non-steward (no existence oracle — NOT a /hub redirect)", async () => {
    testDb = await createTestDatabase();
    const stewardId = await seedSteward("owner");
    const { familyId } = await createFamily(testDb, {
      name: "Esposito",
      creatorPersonId: stewardId,
    });
    // A DIFFERENT account views the page.
    ctxPersonId = await seedSteward("outsider");

    await expect(
      FamilyEditPage({ params: Promise.resolve({ id: familyId }), searchParams: noError }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalled).toBe(true);
    expect(lastRedirect).toBeUndefined();
  });

  it("renders (no throw, non-null element) for the steward — the allow case", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("allow");
    const { familyId } = await createFamily(testDb, {
      name: "Esposito",
      creatorPersonId: ctxPersonId,
    });

    const result = await FamilyEditPage({
      params: Promise.resolve({ id: familyId }),
      searchParams: noError,
    });
    expect(result).not.toBeNull();
    expect(notFoundCalled).toBe(false);
    expect(lastRedirect).toBeUndefined();
  });
});

describe("updateFamilyAction", () => {
  function formData(fields: Record<string, string | undefined>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) fd.set(k, v);
    }
    return fd;
  }

  it("persists the edit and redirects /hub for the steward", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("action-ok");
    const { familyId } = await createFamily(testDb, {
      name: "Esposito",
      creatorPersonId: ctxPersonId,
    });

    const fd = formData({
      familyId,
      name: "The Esposito family",
      shortName: "Esposito",
      description: "Bakers from Naples",
      discoverable: "on",
    });
    await expect(updateFamilyAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/hub");

    const fam = await getFamily(testDb, familyId);
    expect(fam?.name).toBe("The Esposito family");
    expect(fam?.shortName).toBe("Esposito");
    expect(fam?.description).toBe("Bakers from Naples");
    expect(fam?.discoverable).toBe(true);
  });

  it("redirects /hub and leaves the family UNCHANGED for a tampered non-steward familyId", async () => {
    testDb = await createTestDatabase();
    const stewardId = await seedSteward("action-owner");
    const { familyId } = await createFamily(testDb, {
      name: "Esposito",
      description: "Original",
      creatorPersonId: stewardId,
    });
    // ctx is a DIFFERENT account submitting a valid familyId (tampered hidden field).
    ctxPersonId = await seedSteward("action-attacker");

    const fd = formData({
      familyId,
      name: "Hijacked",
      description: "Tampered",
      discoverable: "on",
    });
    await expect(updateFamilyAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/hub");

    const fam = await getFamily(testDb, familyId);
    expect(fam?.name).toBe("Esposito");
    expect(fam?.description).toBe("Original");
    expect(fam?.discoverable).toBe(false);
  });

  it("redirects to the ?error=name screen on an empty name", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("action-noname");
    const { familyId } = await createFamily(testDb, {
      name: "Esposito",
      creatorPersonId: ctxPersonId,
    });

    const fd = formData({ familyId, name: "   " });
    await expect(updateFamilyAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe(`/families/${familyId}/edit?error=name`);
  });

  it("redirects /hub when the familyId is missing", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("action-noid");

    const fd = formData({ name: "Whatever" });
    await expect(updateFamilyAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/hub");
  });

  it("redirects /hub for a malformed (non-UUID) familyId — before any DB write", async () => {
    testDb = await createTestDatabase();
    ctxPersonId = await seedSteward("action-badid");

    const fd = formData({ familyId: "tampered", name: "Whatever" });
    await expect(updateFamilyAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/hub");
  });
});
