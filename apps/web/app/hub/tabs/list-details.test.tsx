// @vitest-environment jsdom
/**
 * #330 — Family List opens the SAME `PersonDetails` sheet Tree uses, minus edge governance / Invite.
 *
 * Composition test: mounts `FamilyTab` (view="list") rather than `KinList` + `PersonDetails` in
 * isolation, so the FamilyTab wiring itself (row → selection → node resolution → sheet) is covered,
 * not just each piece separately.
 *
 *   1. Clicking a List row opens `PersonDetails` (`tree-person-details`) with that person's name.
 *   2. The List path never shows the governable-edges section, even when FamilyTab was handed
 *      non-empty `governableEdges` that DO touch the selected person (Tree-only affordance, #254).
 *   3. Stories/Photos/Mentions links are present with the same hrefs Tree uses.
 *   4. Edit shows up when the (mocked) editability probe says editable — same seam Tree relies on.
 *   5. No Invite button / pending note on the List path (#334 wires Invite later; omitted here).
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GovernableKinEdge, KinshipTreeData } from "@chronicle/core";
import type { FamilyListPerson } from "@/lib/family-list-people";
import { FamilyTab } from "./FamilyTab";

// next/navigation — FamilyTab's onSaved calls router.refresh(); FamilyChips also reads
// usePathname/useSearchParams (mirrors unplaced-members.test.tsx's mock).
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

// The details sheet's editability probe hits a real server action by default (`personEditabilityAction`
// calls `getRuntime()`/`auth`). Mock it here so "Edit appears when editable" is deterministic, mirroring
// how person-details-edit.test.tsx injects a `checkEditable` seam directly (FamilyTab doesn't expose
// that seam — Tree's own mount doesn't either — so the module mock is the composition-level equivalent).
const { personEditabilityAction } = vi.hoisted(() => ({
  personEditabilityAction: vi.fn(async () => ({ ok: true as const, editable: true })),
}));
vi.mock("../tree/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tree/actions")>();
  return { ...actual, personEditabilityAction };
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  personEditabilityAction.mockReset();
  personEditabilityAction.mockImplementation(async () => ({ ok: true as const, editable: true }));
});

function treeData(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: "self",
    nodes: [],
    edges: [],
  };
}

function edge(over: Partial<GovernableKinEdge> & Pick<GovernableKinEdge, "personAId" | "personBId">): GovernableKinEdge {
  return {
    edgeType: over.edgeType ?? "parent_of",
    personAId: over.personAId,
    personBId: over.personBId,
    personADisplayName: over.personADisplayName ?? "Alice",
    personAIdentified: over.personAIdentified ?? true,
    personBDisplayName: over.personBDisplayName ?? "Bob",
    personBIdentified: over.personBIdentified ?? true,
    nature: over.nature ?? "unknown",
    state: over.state ?? "asserted",
    assertedBy: over.assertedBy ?? over.personAId,
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
    viewerCanRemove: over.viewerCanRemove ?? over.viewerIsSteward ?? false,
  };
}

const MARCO: FamilyListPerson = {
  personId: "marco",
  displayName: "Marco",
  identified: true,
  lifeStatus: "living",
  membership: "member",
  relation: "sibling",
};

function renderListTab(over: { governableEdges?: GovernableKinEdge[] } = {}) {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      listPeople={[MARCO]}
      view="list"
      governableEdges={over.governableEdges ?? []}
      surface={{ active: "list", familiesParam: null, showRequests: false }}
    />,
  );
}

it("clicking a List row opens PersonDetails with that person's name", async () => {
  renderListTab();
  expect(screen.queryByTestId("tree-person-details")).toBeNull();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  const sheet = await screen.findByTestId("tree-person-details");
  expect(sheet.textContent).toContain("Marco");
});

it("never shows the governable-edges section on List, even with edges touching the selected person", async () => {
  renderListTab({
    governableEdges: [
      edge({ personAId: "marco", personBId: "self", personADisplayName: "Marco", viewerIsSteward: true }),
    ],
  });
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  expect(screen.queryByTestId("tree-details-gov-edges")).toBeNull();
});

it("Stories/Photos/Mentions links use the same hrefs as Tree", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  expect(screen.getByTestId("tree-details-stories").getAttribute("href")).toBe(
    "/hub/person/marco?section=stories",
  );
  expect(screen.getByTestId("tree-details-photos").getAttribute("href")).toBe(
    "/hub/person/marco?section=photos",
  );
  expect(screen.getByTestId("tree-details-mentions").getAttribute("href")).toBe(
    "/hub/person/marco?section=mentions",
  );
});

it("shows Edit when the (mocked) editability probe says editable", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  expect(await screen.findByTestId("tree-details-edit")).toBeTruthy();
});

it("hides Edit when the editability probe says not editable", async () => {
  personEditabilityAction.mockImplementation(async () => ({ ok: true as const, editable: false }));
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  await waitFor(() => expect(screen.queryByTestId("tree-details-edit")).toBeNull());
});

it("never shows an Invite button or pending note on the List path (#334 lands the modal separately)", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  expect(screen.queryByTestId("tree-details-invite")).toBeNull();
  expect(screen.queryByTestId("tree-details-invite-pending")).toBeNull();
});

it("closing the sheet (×) clears the selection", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-close"));
  expect(screen.queryByTestId("tree-person-details")).toBeNull();
});
