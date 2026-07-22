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
 *   5. No Invite button / pending note for a row whose resolved node carries no live `inviteStatus`
 *      (`resolveListPersonNode` synthesizes `"not-applicable"` for any row outside the tree window —
 *      unrelated to whether `onInvite` is wired).
 *   6. #334 — when a List row's resolved node IS `invitable` (i.e. present in the tree window with a
 *      real `inviteStatus`), the Invite button appears and opens the SAME in-place `PersonInviteModal`
 *      Tree uses, wired via `FamilyTab`'s `onInvite`.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GovernableKinEdge, KinshipTreeData, TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import type { FamilyListPerson } from "@/lib/family-list-people";
import { hydrateFamilyListPeopleIdentity, resolveListPersonNode } from "@/lib/family-list-people";
import type { SavePersonEditResult } from "../tree/actions";
import type { PersonInviteFormState, PersonInviteTargetsResult } from "../tree/person-invite-actions";
import { PersonDetails } from "../tree/person-details";
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
  birthYear: null,
  deathYear: null,
  sex: "unknown",
  inviteStatus: "not-applicable",
};

function renderListTab(
  over: {
    governableEdges?: GovernableKinEdge[];
    tree?: KinshipTreeData;
    listPeople?: FamilyListPerson[];
    fetchInviteTargets?: (personId: string) => Promise<PersonInviteTargetsResult>;
    submitInvite?: (prevState: PersonInviteFormState, formData: FormData) => Promise<PersonInviteFormState>;
  } = {},
) {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={over.tree ?? treeData()}
      listPeople={over.listPeople ?? [MARCO]}
      view="list"
      governableEdges={over.governableEdges ?? []}
      surface={{ active: "list", familiesParam: null, showRequests: false }}
      fetchInviteTargets={over.fetchInviteTargets}
      submitInvite={over.submitInvite}
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

it("never shows an Invite button or pending note for a row with no live invite status", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  expect(screen.queryByTestId("tree-details-invite")).toBeNull();
  expect(screen.queryByTestId("tree-details-invite-pending")).toBeNull();
});

it("#334 — Invite from List details opens the SAME in-place PersonInviteModal Tree uses", async () => {
  // Give Marco a real, invitable resolved node by putting him in the tree window `resolveListPersonNode`
  // prefers — this is the one path where List's synthesized node carries a live `inviteStatus` today.
  const invitableTree: KinshipTreeData = {
    familyId: "F",
    rootPersonId: "self",
    nodes: [
      {
        personId: "marco",
        displayName: "Marco",
        identified: true,
        lifeStatus: "living",
        birthYear: null,
        deathYear: null,
        relationToRoot: "sibling",
        hasHiddenParents: false,
        hasHiddenChildren: false,
        sex: "unknown",
        inviteStatus: "invitable",
      } satisfies TreeNode,
    ],
    edges: [],
  };
  const fetchInviteTargets = vi.fn(
    async (): Promise<PersonInviteTargetsResult> => ({
      ok: true,
      data: {
        families: [{ id: "F", name: "The Carneys", shortName: null }],
        seededFamilyId: "F",
        displayName: "Marco",
        email: "",
        phone: "",
      },
    }),
  );
  renderListTab({ tree: invitableTree, fetchInviteTargets, submitInvite: vi.fn() });

  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  const details = await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-invite"));

  const modal = await screen.findByTestId("person-invite-modal");
  expect(modal.getAttribute("aria-label")).toBe(hub.personInvite.heading("Marco"));
  expect(fetchInviteTargets).toHaveBeenCalledWith("marco");
  // The details sheet stays mounted underneath the modal (#334 AC 4) — List and Tree share this rule.
  expect(details).toBeTruthy();
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();

  fireEvent.click(screen.getByTestId("person-invite-close"));
  expect(screen.queryByTestId("person-invite-modal")).toBeNull();
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();
});

it("#334 fix — Invite shows for a List row NOT present in tree.nodes, once its FamilyListPerson.inviteStatus is hydrated invitable", async () => {
  // The critical #334 gap: `resolveListPersonNode` used to hardcode `inviteStatus: "not-applicable"`
  // for any row absent from `tree.nodes`, so List's Invite button never appeared for unplaced/
  // off-window people even when they were genuinely invitable. This proves the fix WITHOUT stuffing
  // Marco into `tree.nodes` (that would cheat — it'd just re-test the already-covered "in window"
  // path above) — `tree` here has an EMPTY node list; only `listPeople`'s own hydrated
  // `inviteStatus: "invitable"` drives the Invite affordance.
  const invitableMarco: FamilyListPerson = { ...MARCO, inviteStatus: "invitable" };
  const fetchInviteTargets = vi.fn(
    async (): Promise<PersonInviteTargetsResult> => ({
      ok: true,
      data: {
        families: [{ id: "F", name: "The Carneys", shortName: null }],
        seededFamilyId: "F",
        displayName: "Marco",
        email: "",
        phone: "",
      },
    }),
  );
  renderListTab({
    listPeople: [invitableMarco],
    tree: treeData(), // nodes: [] — Marco is NOT materialized in the tree window.
    fetchInviteTargets,
    submitInvite: vi.fn(),
  });

  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-invite"));

  const modal = await screen.findByTestId("person-invite-modal");
  expect(modal.getAttribute("aria-label")).toBe(hub.personInvite.heading("Marco"));
  expect(fetchInviteTargets).toHaveBeenCalledWith("marco");
});

it("closing the sheet (×) clears the selection", async () => {
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-close"));
  expect(screen.queryByTestId("tree-person-details")).toBeNull();
});

it("opens the sheet with position:fixed (viewport placement) so a long List never parks it off-screen (#330)", async () => {
  // PersonDetails' host on Tree is a fixed-height canvas frame, so `position: absolute` (its default)
  // always lands the sheet in view. List's host instead grows with the (potentially long, scrollable)
  // row list, so the sheet would park itself far below the viewport for a lower row. FamilyTab must
  // pass `placement="viewport"` on the List path so the sheet stays `position: fixed` in view.
  renderListTab();
  fireEvent.click(screen.getByTestId("family-list-row-marco"));
  const sheet = await screen.findByTestId("tree-person-details");
  expect(sheet.getAttribute("data-placement")).toBe("viewport");
  expect(sheet.style.position).toBe("fixed");
});

it("#330 fix — Edit→Save from List sends the person's REAL birthYear/sex, not synthesized null/unknown", async () => {
  // Regression for the critical bug: `resolveListPersonNode` used to synthesize birthYear: null,
  // deathYear: null, sex: "unknown" whenever the person wasn't in `tree.nodes` (any unplaced member,
  // or a tree-only relative outside the rendered window). `PersonEditForm` ALWAYS sends
  // displayName/sex/lifeStatus/birthYear on save, so that could silently wipe a real DOB/sex. This
  // mounts `PersonDetails` directly with the exact node `resolveListPersonNode` resolves for a List
  // person who has known identity but is absent from the tree window (empty `tree.nodes`, mirroring
  // FamilyTab's real wiring) and asserts Save's patch carries the REAL values.
  const eleanor: FamilyListPerson = {
    personId: "eleanor",
    displayName: "Eleanor",
    identified: true,
    lifeStatus: "deceased",
    membership: "tree-only",
    relation: "parent",
    birthYear: 1940,
    deathYear: 2010,
    sex: "female",
    inviteStatus: "not-applicable",
  };
  const node = resolveListPersonNode(eleanor, [] /* not in the tree window */);
  expect(node.birthYear).toBe(1940);
  expect(node.sex).toBe("female");

  const saveEdit = vi.fn(
    async (_familyId: string, _personId: string, _patch: unknown): Promise<SavePersonEditResult> => ({
      ok: true,
    }),
  );
  render(
    <PersonDetails
      node={node}
      relationToViewer="parent"
      familyId="F"
      placement="viewport"
      onClose={() => {}}
      checkEditable={async () => ({ ok: true, editable: true })}
      saveEdit={saveEdit}
    />,
  );
  fireEvent.click(await screen.findByTestId("tree-details-edit"));
  // Save WITHOUT touching birth year / sex — the bug reproduces even when the user only edits the
  // name, since the form always re-sends every field from its (previously wrong) initial state.
  fireEvent.change(screen.getByTestId("tree-edit-name"), { target: { value: "Eleanor R." } });
  fireEvent.click(screen.getByTestId("tree-edit-save"));

  await waitFor(() => expect(saveEdit).toHaveBeenCalledTimes(1));
  const [, , patch] = saveEdit.mock.calls[0]!;
  expect(patch).toMatchObject({
    displayName: "Eleanor R.",
    birthYear: 1940,
    sex: "female",
    lifeStatus: "deceased",
    deathYear: 2010,
  });
});

it("#330 fix — unplaced deceased member: hydrate → synthesize → Edit→Save preserves lifeStatus and deathYear", async () => {
  // Unplaced members have no kin entry, so the projector defaults lifeStatus to "living". Without
  // identity hydration, resolveListPersonNode would synthesize living and Save would revive them.
  const projected = [
    {
      personId: "rosa",
      displayName: "Rosa",
      identified: true,
      lifeStatus: "living" as const,
      membership: "member" as const,
      relation: null,
      birthYear: null,
      deathYear: null,
      sex: "unknown" as const,
      inviteStatus: "not-applicable" as const,
    },
  ];
  const [rosa] = hydrateFamilyListPeopleIdentity(
    projected,
    new Map([
      [
        "rosa",
        {
          lifeStatus: "deceased" as const,
          birthYear: 1920,
          deathYear: 1995,
          sex: "female" as const,
          inviteStatus: "not-applicable" as const,
        },
      ],
    ]),
  )!;
  const node = resolveListPersonNode(rosa!, []);
  expect(node.lifeStatus).toBe("deceased");
  expect(node.deathYear).toBe(1995);

  const saveEdit = vi.fn(
    async (_familyId: string, _personId: string, _patch: unknown): Promise<SavePersonEditResult> => ({
      ok: true,
    }),
  );
  render(
    <PersonDetails
      node={node}
      relationToViewer={null}
      familyId="F"
      placement="viewport"
      onClose={() => {}}
      checkEditable={async () => ({ ok: true, editable: true })}
      saveEdit={saveEdit}
    />,
  );
  fireEvent.click(await screen.findByTestId("tree-details-edit"));
  fireEvent.change(screen.getByTestId("tree-edit-name"), { target: { value: "Rosa M." } });
  fireEvent.click(screen.getByTestId("tree-edit-save"));

  await waitFor(() => expect(saveEdit).toHaveBeenCalledTimes(1));
  const [, , patch] = saveEdit.mock.calls[0]!;
  expect(patch).toMatchObject({
    displayName: "Rosa M.",
    lifeStatus: "deceased",
    deathYear: 1995,
    birthYear: 1920,
  });
});
