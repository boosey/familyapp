/**
 * Increment 4B, Task 4.5 — the Invite/Requests tabs resolve the hub scope.
 *
 *   1. Pure tab-visibility + scope-filter helpers (lib/hub-tabs) — shared by page.tsx and RequestsTab.
 *      A pending-only viewer (member of none) sees NEITHER Invite nor Requests.
 *   2. End-to-end: a multi-family steward sees pending requests from EVERY family they steward, each
 *      row carrying its own family name (what RequestsTab renders as the row label); the scope filter
 *      narrows the aggregate to a single family.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { createJoinRequest, listPendingJoinRequestsForSteward } from "@chronicle/core";
import { inviteTabVisible, requestsInScope, requestsTabVisible } from "../lib/hub-tabs";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(name: string): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}
async function makeDiscoverableFamily(name: string, stewardId: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: stewardId, stewardPersonId: stewardId, discoverable: true })
    .returning();
  return f!.id;
}
async function addMembership(personId: string, familyId: string): Promise<void> {
  await db.insert(memberships).values({ personId, familyId, status: "active" });
}

describe("hub tab visibility (pure)", () => {
  it("hides Invite + Requests for a pending-only viewer (member of none)", () => {
    expect(inviteTabVisible(0)).toBe(false);
    expect(requestsTabVisible(0, 3, 2)).toBe(false); // even if requests somehow existed
  });
  it("shows Invite once the viewer is a member of ≥1 family", () => {
    expect(inviteTabVisible(1)).toBe(true);
  });
  it("shows Requests only when a member AND there are pending or decided requests", () => {
    expect(requestsTabVisible(1, 0, 0)).toBe(false);
    expect(requestsTabVisible(1, 1, 0)).toBe(true);
    expect(requestsTabVisible(1, 0, 1)).toBe(true);
  });
});

describe("requestsInScope (pure)", () => {
  const rows = [
    { familyId: "famA", requesterName: "Ann" },
    { familyId: "famB", requesterName: "Bea" },
  ];
  it("keeps every row in 'all'", () => {
    expect(requestsInScope(rows, "all")).toEqual(rows);
  });
  it("narrows to a single family when scoped", () => {
    expect(requestsInScope(rows, "famA")).toEqual([{ familyId: "famA", requesterName: "Ann" }]);
  });
});

describe("multi-family steward sees every family's requests, each labeled", () => {
  it("aggregates across families in 'all' with the family name on each row", async () => {
    const steward = await makePerson("Steward");
    const famA = await makeDiscoverableFamily("Alpha", steward);
    const famB = await makeDiscoverableFamily("Beta", steward);
    await addMembership(steward, famA);
    await addMembership(steward, famB);

    const ann = await makePerson("Ann");
    const bea = await makePerson("Bea");
    await createJoinRequest(db, { familyId: famA, requesterPersonId: ann });
    await createJoinRequest(db, { familyId: famB, requesterPersonId: bea });

    const pending = await listPendingJoinRequestsForSteward(db, steward);
    // Both families' requests are present, each labeled with its own family name.
    const byFamily = new Map(pending.map((r) => [r.familyName, r.requesterName]));
    expect(byFamily.get("Alpha")).toBe("Ann");
    expect(byFamily.get("Beta")).toBe("Bea");
    expect(pending.length).toBe(2);

    // "all" keeps both; scoping to Alpha's id narrows to Ann only.
    expect(requestsInScope(pending, "all").length).toBe(2);
    const scoped = requestsInScope(pending, famA);
    expect(scoped.length).toBe(1);
    expect(scoped[0]!.familyName).toBe("Alpha");
  });
});
