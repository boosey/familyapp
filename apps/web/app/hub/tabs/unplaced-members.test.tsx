// @vitest-environment jsdom
/**
 * #161 (ADR-0023) unplaced-members web tests ΓÇö RENDER + WIRING (the data correctness is core-tested).
 *
 *   1. Unplaced members supplied by the core read render as a not-yet-connected tray on the Tree
 *      view. List is browse-only (#283) and must NOT host the unplaced mutation section.
 *   2. The three per-member actions are present and invoke the right (stubbed) server action:
 *      place-in-tree opens the link modal and calls linkExistingMember; "Not family" calls
 *      setMemberNonFamily(true); steward "Remove" requires an in-page confirm then calls endMembership.
 *   3. Remove is steward-only (hidden for a non-steward viewer). No native confirm() is used.
 *   4. #285 Place modal: partnerΓåÆkids step offer after kin options resolve; never partner-only while loading.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { KinshipTreeData, TreeNode, UnplacedMember } from "@chronicle/core";
import { UnplacedMembers } from "./UnplacedMembers";
import { FamilyTab } from "./FamilyTab";
import type { PersonKinOptionsResult } from "../tree/actions";

// next/navigation ΓÇö the panel calls router.refresh() after a successful action; FamilyTab's
// FamilyChips also reads usePathname/useSearchParams, so the mock supplies all three.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

const { listPersonKinOptionsAction } = vi.hoisted(() => ({
  listPersonKinOptionsAction: vi.fn(async (): Promise<PersonKinOptionsResult> => ({
    ok: true,
    partners: [],
    children: [],
  })),
}));
vi.mock("../tree/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tree/actions")>();
  return {
    ...actual,
    listPersonKinOptionsAction,
  };
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  listPersonKinOptionsAction.mockReset();
  listPersonKinOptionsAction.mockImplementation(async (): Promise<PersonKinOptionsResult> => ({
    ok: true,
    partners: [],
    children: [],
  }));
});

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

const MEMBERS: UnplacedMember[] = [
  { personId: "u1", displayName: "Rosa Esposito", role: "member" },
  { personId: "u2", displayName: "Marco Ricci", role: "member" },
];

const okAction = async () => ({ ok: true as const });

function renderPanel(over: Partial<React.ComponentProps<typeof UnplacedMembers>> = {}) {
  const onLink = over.onLink ?? vi.fn(okAction);
  const onSetNonFamily = over.onSetNonFamily ?? vi.fn(okAction);
  const onEndMembership = over.onEndMembership ?? vi.fn(okAction);
  const onFetchAnchors =
    over.onFetchAnchors ??
    vi.fn(async () => ({
      ok: true as const,
      persons: [
        { personId: "self", displayName: "You" },
        { personId: "elena", displayName: "Elena" },
      ],
    }));
  render(
    <UnplacedMembers
      familyId="F"
      members={MEMBERS}
      viewerIsSteward={over.viewerIsSteward ?? false}
      variant={over.variant ?? "section"}
      showNewPerson={over.showNewPerson}
      onLink={onLink}
      onSetNonFamily={onSetNonFamily}
      onEndMembership={onEndMembership}
      onFetchAnchors={onFetchAnchors}
    />,
  );
  return { onLink, onSetNonFamily, onEndMembership, onFetchAnchors };
}

/* ΓöÇΓöÇ 1. Both surfaces render the unplaced members ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */

function treeData(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: "self",
    nodes: [node({ personId: "self", displayName: "You", relationToRoot: "self" })],
    edges: [],
  };
}

it("#283: List view does not render the unplaced mutation section", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      listPeople={[]}
      unplaced={MEMBERS}
      viewerIsSteward={false}
      view="list"
      // #189: FamilyTab now renders the shared toolbar; R1's data is threaded through `surface`.
      surface={{ active: "list", familiesParam: null, showRequests: false }}
    />,
  );
  expect(screen.queryByTestId("unplaced-members")).toBeNull();
  expect(screen.queryByTestId("unplaced-place-u1")).toBeNull();
  expect(screen.queryByTestId("unplaced-nonfamily-u1")).toBeNull();
  expect(screen.queryByTestId("unplaced-remove-u1")).toBeNull();
});

it("renders unplaced members as a not-yet-connected tray in the Tree view", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      listPeople={[]}
      unplaced={MEMBERS}
      viewerIsSteward={false}
      view="tree"
      // #189: FamilyTab now renders the shared toolbar; R1's data is threaded through `surface`.
      surface={{ active: "tree", familiesParam: null, showRequests: false }}
    />,
  );
  // The tray is present in the tree view (variant "tray" adds the section testid) and lists the members.
  const tray = screen.getByTestId("unplaced-members");
  expect(within(tray).getByTestId("unplaced-row-u1")).toBeTruthy();
  expect(within(tray).getByTestId("tree-tray-new-person")).toBeTruthy();
  // It sits OUTSIDE the pan/zoom layer (the layout engine) ΓÇö the tray is not inside tree-pan-layer.
  const panLayer = screen.getByTestId("tree-pan-layer");
  expect(panLayer.contains(tray)).toBe(false);
  // #287: desktop tray exposes dedicated drag handles (SSR/jsdom = non-compact).
  expect(within(tray).getByTestId("unplaced-drag-u1")).toBeTruthy();
  expect(within(tray).getByTestId("tree-tray-new-person").getAttribute("draggable")).toBe("true");
});

it("#287: tray drag handle writes place-drag payload and arms the active-drag store", async () => {
  const { setActivePlaceDrag, getActivePlaceDrag, PLACE_DRAG_MIME } = await import(
    "../tree/place-drag"
  );
  setActivePlaceDrag(null);
  renderPanel({ variant: "tray", showNewPerson: true });

  const handle = screen.getByTestId("unplaced-drag-u1");
  const dataTransfer = {
    setData: vi.fn(),
    effectAllowed: "none" as string,
  };
  fireEvent.dragStart(handle, { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenCalledWith(
    PLACE_DRAG_MIME,
    expect.stringContaining('"personId":"u1"'),
  );
  expect(getActivePlaceDrag()).toEqual({
    kind: "link",
    personId: "u1",
    displayName: "Rosa Esposito",
  });

  fireEvent.dragEnd(handle);
  expect(getActivePlaceDrag()).toBeNull();

  const neu = screen.getByTestId("tree-tray-new-person");
  fireEvent.dragStart(neu, { dataTransfer });
  expect(getActivePlaceDrag()).toEqual({ kind: "mint" });
  fireEvent.dragEnd(neu);
  expect(getActivePlaceDrag()).toBeNull();
});

it("#286: Tree tray shows New person even when there are no unplaced members", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      listPeople={[]}
      unplaced={[]}
      viewerIsSteward={false}
      view="tree"
      surface={{ active: "tree", familiesParam: null, showRequests: false }}
    />,
  );
  expect(screen.getByTestId("unplaced-members")).toBeTruthy();
  expect(screen.getByTestId("tree-tray-new-person")).toBeTruthy();
});

/* ΓöÇΓöÇ 2. Actions invoke the right handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */

it("place-in-tree opens the link modal, fetches anchors, and calls linkExistingMember with anchor + relation", async () => {
  const { onLink, onFetchAnchors } = renderPanel();
  act(() => screen.getByTestId("unplaced-place-u1").click());

  // Modal opens; anchors are fetched asynchronously.
  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  expect(screen.getByTestId("place-confirm-loading-anchors")).toBeTruthy();

  await act(async () => {
    // Let the microtask queue flush so the fetch resolves.
    await new Promise((r) => setTimeout(r, 0));
  });
  // Kin options load after anchor is seeded ΓÇö submit stays disabled until ready.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  expect(onFetchAnchors).toHaveBeenCalledWith("F");
  const anchor = screen.getByTestId("place-confirm-receiver") as HTMLSelectElement;
  const relation = screen.getByTestId("place-confirm-relation") as HTMLSelectElement;
  fireEvent.change(anchor, { target: { value: "elena" } });
  // Anchor change re-fetches kin options.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.change(relation, { target: { value: "child" } });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });

  expect(onLink).toHaveBeenCalledTimes(1);
  expect(onLink).toHaveBeenCalledWith("F", "u1", "child", "elena", undefined, {
    coParentPersonIds: undefined,
    nature: "biological",
    stepParentOfChildIds: undefined,
  });
});

it("place-in-tree excludes the member being placed from seed anchors (#250)", async () => {
  // Zero-edge seed fallback returns every active member, including the one being placed.
  // The modal must not offer a self-link ΓÇö only the other seed person remains.
  renderPanel({
    onFetchAnchors: vi.fn(async () => ({
      ok: true as const,
      persons: [
        { personId: "u1", displayName: "Rosa Esposito" },
        { personId: "john", displayName: "John" },
      ],
    })),
  });
  act(() => screen.getByTestId("unplaced-place-u1").click());

  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  const anchor = screen.getByTestId("place-confirm-receiver") as HTMLSelectElement;
  const options = Array.from(anchor.options).map((o) => o.value);
  expect(options).toEqual(["john"]);
  expect(screen.queryByTestId("place-confirm-no-anchors")).toBeNull();
});

it("place-in-tree shows no-anchors when the only seed person is the member (#250)", async () => {
  renderPanel({
    onFetchAnchors: vi.fn(async () => ({
      ok: true as const,
      persons: [{ personId: "u1", displayName: "Rosa Esposito" }],
    })),
  });
  act(() => screen.getByTestId("unplaced-place-u1").click());

  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  expect(screen.getByTestId("place-confirm-no-anchors")).toBeTruthy();
  expect(screen.queryByTestId("place-confirm-receiver")).toBeNull();
});

it("'Not family' calls setMemberNonFamily(true) and offers a Move-back undo", async () => {
  const { onSetNonFamily } = renderPanel();
  await act(async () => {
    screen.getByTestId("unplaced-nonfamily-u1").click();
  });
  expect(onSetNonFamily).toHaveBeenCalledWith("F", "u1", true);
  // The member moves to the set-aside sub-list with a restore control.
  expect(screen.getByTestId("unplaced-restore-u1")).toBeTruthy();
});

it("steward Remove requires an in-page confirm, then calls endMembership (no native confirm)", async () => {
  const confirmSpy = vi.spyOn(window, "confirm");
  const { onEndMembership } = renderPanel({ viewerIsSteward: true });

  // First tap arms the in-page confirm (does NOT call the action yet).
  act(() => screen.getByTestId("unplaced-remove-u1").click());
  expect(onEndMembership).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();

  // Confirm tap fires the action.
  await act(async () => {
    screen.getByTestId("unplaced-remove-confirm-u1").click();
  });
  expect(onEndMembership).toHaveBeenCalledWith("F", "u1");
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

/* ΓöÇΓöÇ 3. Remove is steward-only ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */

it("hides the Remove action for a non-steward viewer", () => {
  renderPanel({ viewerIsSteward: false });
  expect(screen.queryByTestId("unplaced-remove-u1")).toBeNull();
  // But place + non-family are always available to any active member.
  expect(screen.getByTestId("unplaced-place-u1")).toBeTruthy();
  expect(screen.getByTestId("unplaced-nonfamily-u1")).toBeTruthy();
});

it("renders nothing when there are no unplaced members and New person is off", () => {
  render(
    <UnplacedMembers
      familyId="F"
      members={[]}
      viewerIsSteward
    />,
  );
  expect(screen.queryByTestId("unplaced-members")).toBeNull();
});

it("#286: Tree tray with showNewPerson stays mounted when unplaced is empty", () => {
  render(
    <UnplacedMembers
      familyId="F"
      members={[]}
      viewerIsSteward
      variant="tray"
      showNewPerson
    />,
  );
  expect(screen.getByTestId("unplaced-members")).toBeTruthy();
  expect(screen.getByTestId("tree-tray-new-person")).toBeTruthy();
});

it("#286: New person and Place both open the shared place-confirm modal", async () => {
  const { onLink } = renderPanel({ showNewPerson: true, variant: "tray" });
  act(() => screen.getByTestId("tree-tray-new-person").click());
  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(screen.getByTestId("place-confirm-name")).toBeTruthy();
  expect(onLink).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(screen.queryByTestId("place-confirm-modal")).toBeNull();

  act(() => screen.getByTestId("unplaced-place-u1").click());
  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(screen.queryByTestId("place-confirm-name")).toBeNull();
  expect(screen.getByTestId("place-confirm-subject")).toBeTruthy();
});

/* ΓöÇΓöÇ 4. Place modal partnerΓåÆkids step offer (#285 / ADR-0027) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */

async function openPlaceModalReady(onFetchAnchors?: ReturnType<typeof vi.fn>) {
  const { onLink } = renderPanel(
    onFetchAnchors
      ? { onFetchAnchors: onFetchAnchors as never }
      : {},
  );
  act(() => screen.getByTestId("unplaced-place-u1").click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { onLink };
}

it("place partner with anchor kids shows step offer then links with stepParentOfChildIds (#285)", async () => {
  listPersonKinOptionsAction.mockImplementation(async (): Promise<PersonKinOptionsResult> => ({
    ok: true,
    partners: [],
    children: [
      { id: "kid-1", name: "Kid One" },
      { id: "kid-2", name: "Kid Two" },
    ],
  }));

  const { onLink } = await openPlaceModalReady();

  fireEvent.change(screen.getByTestId("place-confirm-relation"), {
    target: { value: "partner" },
  });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });

  expect(onLink).not.toHaveBeenCalled();
  expect(screen.getByTestId("place-confirm-step-offer")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("place-confirm-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("place-confirm-step-confirm"));
  });

  expect(onLink).toHaveBeenCalledWith("F", "u1", "partner", "self", undefined, {
    coParentPersonIds: undefined,
    nature: undefined,
    stepParentOfChildIds: ["kid-1"],
  });
});

it("place partner submit stays disabled while kin options are still loading (#285)", async () => {
  let resolveKin!: (value: PersonKinOptionsResult) => void;
  listPersonKinOptionsAction.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveKin = resolve;
      }),
  );

  renderPanel();
  act(() => screen.getByTestId("unplaced-place-u1").click());

  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  // Anchors ready, kin still pending ΓÇö must not allow a silent partner-only submit.
  const submit = screen.getByTestId("place-confirm-submit") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByTestId("place-confirm-relation"), {
    target: { value: "partner" },
  });
  expect(submit.disabled).toBe(true);

  await act(async () => {
    resolveKin({
      ok: true,
      partners: [],
      children: [{ id: "kid-1", name: "Kid One" }],
    });
    await new Promise((r) => setTimeout(r, 0));
  });

  expect(submit.disabled).toBe(false);

  await act(async () => {
    fireEvent.submit(submit.closest("form")!);
  });
  expect(screen.getByTestId("place-confirm-step-offer")).toBeTruthy();
});

it("place modal kin-options reject keeps submit disabled and shows error (#285/#286)", async () => {
  listPersonKinOptionsAction.mockImplementation(async (): Promise<PersonKinOptionsResult> => ({
    ok: false,
    error: "failed",
  }));

  const { onLink } = await openPlaceModalReady();

  const submit = screen.getByTestId("place-confirm-submit") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(screen.getByTestId("place-confirm-error").textContent).toMatch(/Couldn't do that/i);

  fireEvent.change(screen.getByTestId("place-confirm-relation"), {
    target: { value: "partner" },
  });
  await act(async () => {
    fireEvent.submit(submit.closest("form")!);
  });

  expect(submit.disabled).toBe(true);
  expect(onLink).not.toHaveBeenCalled();
});
