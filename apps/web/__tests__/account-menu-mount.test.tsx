/**
 * Regression: the account menu is reachable on EVERY authenticated screen, not just /hub.
 *
 * Before this, <KindredAccountMenu> was inlined only in app/hub/page.tsx. A signed-in account that
 * was NOT on the hub — a pending join-request applicant parked on /families/find or /welcome, or any
 * secondary /hub/* screen — had no avatar menu and therefore no way to log out or switch user: an
 * unbreakable loop. <AccountMenuMount> now renders once from the root layout and self-gates on auth,
 * so the menu (with its log-out item) appears for any account holder regardless of onboarding state.
 *
 * The RSC component cannot be rendered in vitest (same constraint as hub-guard.test.ts), so we invoke
 * it as a plain async function and inspect the returned element tree. Seams mocked:
 *   1. `@/lib/runtime` getRuntime() — real PGlite db + a stub auth with a controllable context.
 *   2. `@/lib/clerk-config` isClerkConfigured() — pinned false (the dev/mock sign-out path).
 *   3. `next/navigation` redirect() — stubbed; only referenced by the (never-invoked) log-out action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { createAccountWithPerson } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { ReactElement } from "react";

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

vi.mock("@/lib/clerk-config", () => ({ isClerkConfigured: () => false }));

// redirect is only reachable via the log-out action, which this test never invokes; stub it so
// importing account-menu-actions doesn't reach for a real Next request context.
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

// Import AFTER mocks so vi.mock hoisting applies.
import { AccountMenuMount } from "@/app/_kindred/AccountMenuMount";

beforeEach(() => {
  ctxKind = "account";
});

describe("AccountMenuMount self-gating", () => {
  it("renders nothing for an anonymous / link-session visitor", async () => {
    ctxKind = "anonymous";
    testDb = await createTestDatabase();

    expect(await AccountMenuMount()).toBeNull();
  });

  it("renders the menu (initials + log-out) for a signed-in account, even before onboarding", async () => {
    testDb = await createTestDatabase();
    // A bare account with NO family and NOT onboarded — exactly the pending-applicant state that had
    // no way out before. createAccountWithPerson deliberately does not onboard or join a family.
    const { personId } = await createAccountWithPerson(testDb, {
      authProviderUserId: "acct-menu-mount",
      email: "acct-menu-mount@example.test",
      displayName: "Ada Lovelace",
    });
    ctxPersonId = personId;

    const result = (await AccountMenuMount()) as ReactElement;
    expect(result).not.toBeNull();

    // Fixed-position wrapper <div> → <KindredAccountMenu> child.
    const menu = (result.props as { children: ReactElement }).children;
    const props = menu.props as {
      initials: string;
      items: Array<{ key: string }>;
      clerkSignOut: boolean;
    };
    // createAccountWithPerson derives a single-word spokenName ("Ada"), so one initial.
    expect(props.initials).toBe("A");
    expect(props.clerkSignOut).toBe(false);
    expect(props.items.some((i) => i.key === "log-out")).toBe(true);
    expect(props.items.some((i) => i.key === "switch-user")).toBe(true);
  });
});
