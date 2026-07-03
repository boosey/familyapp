/**
 * Regression: /hub is guarded by the family-first gate.
 *
 * The decision logic (`resolvePostAuthRoute`) is exhaustively covered in post-auth-route.test.ts.
 * This pins the WIRING added to app/hub/page.tsx: a family-less / not-yet-onboarded account that
 * lands on /hub directly (stale bookmark, back button, /dev/sign-in) is bounced to the step it
 * still owes BEFORE any feed query runs — /hub was previously the only authenticated surface not
 * routed through resolvePostAuthRoute.
 *
 * The RSC page cannot be rendered in vitest (same constraint documented in join-clerk.test.ts), so
 * we invoke HubPage as a plain async function with two seams mocked:
 *   1. `@/lib/runtime` getRuntime() — returns a real PGlite db + a stub auth reporting an "account"
 *      context, so the guard runs against real identity-graph rows.
 *   2. `next/navigation` redirect() — captured (and thrown, mimicking Next) so we can assert the
 *      destination without a request context.
 * We also stub `@/lib/hub-data` loadHubFeed so that, if the guard ever FAILED to short-circuit, the
 * test would observe the feed load — letting us assert the guard runs BEFORE the expensive queries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { createAccountWithPerson, completeOnboarding, createFamily } from "@chronicle/core";
import type { Database } from "@chronicle/db";

// ── Seams ────────────────────────────────────────────────────────────────────────────────────────
let lastRedirect: string | undefined;
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    lastRedirect = url;
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  },
}));

// Test-controlled runtime: a real PGlite db + a stub auth returning an account context.
let testDb: Database;
let ctxPersonId: string;
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: testDb,
    auth: {
      getCurrentAuthContext: async () => ({ kind: "account", personId: ctxPersonId }),
    },
  }),
  isClerkConfigured: () => false,
}));

// Trip-wire on the expensive feed load: if the guard did NOT short-circuit, HubPage would call this.
const feedLoaded = vi.fn(async () => []);
vi.mock("@/lib/hub-data", () => ({
  loadHubFeed: () => feedLoaded(),
  loadSeenStoryIds: async () => new Set<string>(),
  loadViewerFamilies: async () => [],
  loadStoryFamilyTargets: async () => ({}),
}));

// Import AFTER mocks so vi.mock hoisting applies.
import HubPage from "@/app/hub/page";

const noSearchParams = Promise.resolve({});

beforeEach(() => {
  lastRedirect = undefined;
  feedLoaded.mockClear();
});

describe("/hub family-first guard (wiring)", () => {
  it("bounces a family-less account to /families/start before loading the feed", async () => {
    testDb = await createTestDatabase();
    const { personId } = await createAccountWithPerson(testDb, {
      authProviderUserId: "hub-guard-familyless",
      email: "hub-guard-familyless@example.test",
      displayName: "No Family",
    });
    ctxPersonId = personId;

    await expect(HubPage({ searchParams: noSearchParams })).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/families/start");
    // The guard short-circuited BEFORE the expensive feed queries.
    expect(feedLoaded).not.toHaveBeenCalled();
  });

  it("bounces a family-holding but not-onboarded account to /welcome", async () => {
    testDb = await createTestDatabase();
    const { personId } = await createAccountWithPerson(testDb, {
      authProviderUserId: "hub-guard-notonboarded",
      email: "hub-guard-notonboarded@example.test",
      displayName: "Not Onboarded",
    });
    await createFamily(testDb, { name: "The Guard Family", creatorPersonId: personId });
    ctxPersonId = personId;

    await expect(HubPage({ searchParams: noSearchParams })).rejects.toThrow("NEXT_REDIRECT");
    expect(lastRedirect).toBe("/welcome");
    expect(feedLoaded).not.toHaveBeenCalled();
  });

  it("does NOT redirect an onboarded member — the feed loads", async () => {
    testDb = await createTestDatabase();
    const { personId } = await createAccountWithPerson(testDb, {
      authProviderUserId: "hub-guard-member",
      email: "hub-guard-member@example.test",
      displayName: "Real Member",
    });
    await createFamily(testDb, { name: "The Member Family", creatorPersonId: personId });
    await completeOnboarding(testDb, personId, { displayName: "Real Member", year: 1970, month: 6, day: 15 });
    ctxPersonId = personId;

    // resolvePostAuthRoute returns "/hub" → no redirect; HubPage proceeds into the data section
    // and calls loadHubFeed (proving the guard let an onboarded member through).
    await HubPage({ searchParams: noSearchParams }).catch(() => undefined);
    expect(lastRedirect).toBeUndefined();
    expect(feedLoaded).toHaveBeenCalledTimes(1);
  });
});
