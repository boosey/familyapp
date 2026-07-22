// @vitest-environment jsdom
/**
 * #161 (ADR-0023) unplaced-members web tests — RENDER + WIRING (the data correctness is core-tested).
 *
 *   1. Unplaced members supplied by the core read render as rows in the List view AND as not-yet-
 *      connected tray cards in the Tree view (both surfaces, per ADR-0023).
 *   2. The three per-member actions are present and invoke the right (stubbed) server action:
 *      place-in-tree opens the link modal and calls linkExistingMember; "Not family" calls
 *      setMemberNonFamily(true); steward "Remove" requires an in-page confirm then calls endMembership.
 *   3. Remove is steward-only (hidden for a non-steward viewer). No native confirm() is used.
 *   4. #285 Place modal: partner→kids step offer after kin options resolve; never partner-only while loading.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { KinshipTreeData, TreeNode, UnplacedMember } from "@chronicle/core";
import { UnplacedMembers } from "./UnplacedMembers";
import { FamilyTab } from "./FamilyTab";

// next/navigation — the panel calls router.refresh() after a successful action; FamilyTab's
// FamilyChips also reads usePathname/useSearchParams, so the mock supplies all three.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

const { listPersonKinOptionsAction } = vi.hoisted(() => ({
  listPersonKinOptionsAction: vi.fn(async () => ({
    ok: true as const,
    partners: [] as { id: string; name: string }[],
    children: [] as { id: string; name: string }[],
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
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
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
      onLink={onLink}
      onSetNonFamily={onSetNonFamily}
      onEndMembership={onEndMembership}
      onFetchAnchors={onFetchAnchors}
    />,
  );
  return { onLink, onSetNonFamily, onEndMembership, onFetchAnchors };
}

/* ── 1. Both surfaces render the unplaced members ─────────────────────────────── */

function treeData(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: "self",
    nodes: [node({ personId: "self", displayName: "You", relationToRoot: "self" })],
    edges: [],
  };
}

it("renders unplaced members as rows in the List view", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      kin={[]}
      unplaced={MEMBERS}
      viewerIsSteward={false}
      view="list"
      // #189: FamilyTab now renders the shared toolbar; R1's data is threaded through `surface`.
      surface={{ active: "list", familiesParam: null, showRequests: false }}
    />,
  );
  const panel = screen.getByTestId("unplaced-members");
  expect(within(panel).getByTestId("unplaced-row-u1")).toBeTruthy();
  expect(within(panel).getByTestId("unplaced-row-u2")).toBeTruthy();
  expect(panel.textContent).toContain("Rosa Esposito");
});

it("renders unplaced members as a not-yet-connected tray in the Tree view", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      kin={[]}
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
  // It sits OUTSIDE the pan/zoom layer (the layout engine) — the tray is not inside tree-pan-layer.
  const panLayer = screen.getByTestId("tree-pan-layer");
  expect(panLayer.contains(tray)).toBe(false);
});

/* ── 2. Actions invoke the right handler ──────────────────────────────────────── */

it("place-in-tree opens the link modal, fetches anchors, and calls linkExistingMember with anchor + relation", async () => {
  const { onLink, onFetchAnchors } = renderPanel();
  act(() => screen.getByTestId("unplaced-place-u1").click());

  // Modal opens; anchors are fetched asynchronously.
  expect(screen.getByTestId("place-member-modal")).toBeTruthy();
  expect(screen.getByTestId("place-member-loading-anchors")).toBeTruthy();

  await act(async () => {
    // Let the microtask queue flush so the fetch resolves.
    await new Promise((r) => setTimeout(r, 0));
  });
  // Kin options load after anchor is seeded — submit stays disabled until ready.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  expect(onFetchAnchors).toHaveBeenCalledWith("F");
  const anchor = screen.getByTestId("place-member-anchor") as HTMLSelectElement;
  const relation = screen.getByTestId("place-member-relation") as HTMLSelectElement;
  fireEvent.change(anchor, { target: { value: "elena" } });
  // Anchor change re-fetches kin options.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.change(relation, { target: { value: "child" } });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-member-submit").closest("form")!);
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
  // The modal must not offer a self-link — only the other seed person remains.
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

  const anchor = screen.getByTestId("place-member-anchor") as HTMLSelectElement;
  const options = Array.from(anchor.options).map((o) => o.value);
  expect(options).toEqual(["john"]);
  expect(screen.queryByTestId("place-member-no-anchors")).toBeNull();
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

  expect(screen.getByTestId("place-member-no-anchors")).toBeTruthy();
  expect(screen.queryByTestId("place-member-anchor")).toBeNull();
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

/* ── 3. Remove is steward-only ────────────────────────────────────────────────── */

it("hides the Remove action for a non-steward viewer", () => {
  renderPanel({ viewerIsSteward: false });
  expect(screen.queryByTestId("unplaced-remove-u1")).toBeNull();
  // But place + non-family are always available to any active member.
  expect(screen.getByTestId("unplaced-place-u1")).toBeTruthy();
  expect(screen.getByTestId("unplaced-nonfamily-u1")).toBeTruthy();
});

it("renders nothing when there are no unplaced members", () => {
  render(
    <UnplacedMembers
      familyId="F"
      members={[]}
      viewerIsSteward
    />,
  );
  expect(screen.queryByTestId("unplaced-members")).toBeNull();
});

/* ── 4. Place modal partner→kids step offer (#285 / ADR-0027) ─────────────────── */

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
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
    partners: [],
    children: [
      { id: "kid-1", name: "Kid One" },
      { id: "kid-2", name: "Kid Two" },
    ],
  }));

  const { onLink } = await openPlaceModalReady();

  fireEvent.change(screen.getByTestId("place-member-relation"), {
    target: { value: "partner" },
  });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-member-submit").closest("form")!);
  });

  expect(onLink).not.toHaveBeenCalled();
  expect(screen.getByTestId("place-member-step-offer")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("place-member-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("place-member-step-confirm"));
  });

  expect(onLink).toHaveBeenCalledWith("F", "u1", "partner", "self", undefined, {
    coParentPersonIds: undefined,
    nature: undefined,
    stepParentOfChildIds: ["kid-1"],
  });
});

it("place partner submit stays disabled while kin options are still loading (#285)", async () => {
  let resolveKin!: (value: {
    ok: true;
    partners: { id: string; name: string }[];
    children: { id: string; name: string }[];
  }) => void;
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

  // Anchors ready, kin still pending — must not allow a silent partner-only submit.
  const submit = screen.getByTestId("place-member-submit") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByTestId("place-member-relation"), {
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
  expect(screen.getByTestId("place-member-step-offer")).toBeTruthy();
});
