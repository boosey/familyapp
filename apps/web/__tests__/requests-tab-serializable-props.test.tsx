/**
 * Regression: the Requests sub-tab 500'd in production with
 *
 *   Error: Functions cannot be passed directly to Client Components unless you explicitly expose it
 *   by marking it with "use server". … {…, badgeLabel: function pendingCountAria}
 *
 * RequestsTab is a Server Component; #159 moved the family-chip bar out of a client "designator" and
 * rendered <FamilyChips> (a Client Component) directly from the server. It kept passing the
 * `hub.requests.pendingCountAria` COPY FUNCTION as the chip badge's accessible-name formatter — but a
 * plain function can't cross the RSC boundary, so the RSC serializer threw and the tab returned a 500.
 *
 * The fix precomputes the per-family badge labels as serializable STRINGS server-side and passes them
 * as `badgeLabels` (a Record). This test reproduces the ROOT CAUSE deterministically: it renders
 * RequestsTab and asserts NO prop reaching the <FamilyChips> element is a function. (renderToStaticMarkup
 * doesn't run the Flight serializer, so it wouldn't catch this — we inspect the element tree directly.)
 *
 * #297: chips now ride inside FamilySurfaceNav's progressive Family unit (not a second toolbar row).
 */
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, joinRequests, memberships, persons } from "@chronicle/db/schema";
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { RequestsTab } from "@/app/hub/tabs/RequestsTab";
import { FamilyChips } from "@/app/hub/FamilyChips";
import { FamilySurfaceNav } from "@/app/hub/FamilySurfaceNav";
import { hub } from "@/app/_copy";
import { pendingRequestChipBadges } from "@/lib/hub-tabs";

async function makePerson(db: Database, name: string): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

async function makeFamily(db: Database, name: string, steward: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: steward, stewardPersonId: steward })
    .returning();
  await db.insert(memberships).values({ personId: steward, familyId: f!.id, status: "active" });
  return f!.id;
}

async function requestJoin(db: Database, requester: string, familyId: string): Promise<void> {
  await db.insert(joinRequests).values({ familyId, requesterPersonId: requester, status: "pending" });
}

/** Depth-first collect every React element in a rendered tree. */
function collectElements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out);
    return out;
  }
  if (isValidElement(node)) {
    out.push(node);
    collectElements((node.props as { children?: unknown }).children, out);
  }
  return out;
}

const SURFACE = {
  familiesParam: null as string | null,
  showRequests: true,
  requestsBadge: 1,
  invite: {
    families: [{ id: "fam-a", name: "Esposito" }],
    seededFamily: "fam-a" as string | null,
  },
};

describe("RequestsTab → FamilyChips props are serializable (RSC-boundary regression)", () => {
  it("passes NO function prop to the client <FamilyChips> (badge label is precomputed strings)", async () => {
    runtimeDb = await createTestDatabase();
    const steward = await makePerson(runtimeDb, "Rosa");
    // Two families so <FamilyChips> actually renders (it self-hides for a <2-family viewer), and the
    // badge/label maps are populated.
    const famA = await makeFamily(runtimeDb, "Esposito", steward);
    const famB = await makeFamily(runtimeDb, "Marino", steward);
    const requester = await makePerson(runtimeDb, "Newcomer");
    await requestJoin(runtimeDb, requester, famA);
    authCtx = { kind: "account", personId: steward };

    const activeFamilies = await listActiveFamiliesForPerson(runtimeDb, steward);
    const families = activeFamilies.map((f) => ({
      id: f.familyId,
      name: f.familyName,
      shortName: f.familyShortName,
    }));

    const tree = await RequestsTab({ families, scopeFamilyId: famB, surface: SURFACE });

    const elements = collectElements(tree);
    const nav = elements.find((el) => el.type === FamilySurfaceNav);
    expect(nav, "RequestsTab should own FamilySurfaceNav").toBeDefined();
    expect((nav!.props as { active?: string }).active).toBe("requests");

    const chipsNode = (nav!.props as { row2Left?: unknown }).row2Left;
    expect(isValidElement(chipsNode) && chipsNode.type === FamilyChips).toBe(true);
    const chips = chipsNode as ReactElement;

    // The exact defect: a function value reaching the client component's props.
    const functionProps = Object.entries(chips.props as Record<string, unknown>)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    expect(functionProps).toEqual([]);

    // And the fix's positive shape: a precomputed per-family label map of STRINGS.
    const { badgeLabels } = chips.props as { badgeLabels?: Record<string, string> };
    expect(badgeLabels?.[famA]).toBe("1 pending");
    expect(Object.values(badgeLabels ?? {}).every((v) => typeof v === "string")).toBe(true);
  });

  it("omits FamilyChips for a single-family steward (progressive Family unit absent)", async () => {
    runtimeDb = await createTestDatabase();
    const steward = await makePerson(runtimeDb, "Rosa");
    await makeFamily(runtimeDb, "Esposito", steward);
    authCtx = { kind: "account", personId: steward };

    const tree = await RequestsTab({
      families: [],
      scopeFamilyId: "all",
      surface: SURFACE,
    });
    const elements = collectElements(tree);
    expect(elements.find((el) => el.type === FamilyChips)).toBeUndefined();
    const nav = elements.find((el) => el.type === FamilySurfaceNav);
    expect((nav!.props as { row2Left?: unknown }).row2Left).toBeNull();
  });
});

describe("pendingRequestChipBadges", () => {
  it("builds serializable badge maps without retaining the label formatter", () => {
    const { badges, badgeLabels } = pendingRequestChipBadges(
      [{ familyId: "a" }, { familyId: "a" }, { familyId: "b" }],
      hub.requests.pendingCountAria,
    );
    expect(badges).toEqual({ a: 2, b: 1 });
    expect(badgeLabels).toEqual({ a: "2 pending", b: "1 pending" });
    expect(Object.values(badgeLabels).every((v) => typeof v === "string")).toBe(true);
  });
});
