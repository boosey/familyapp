// @vitest-environment jsdom
/**
 * #288 — mobile Place → tap person → tap zone (ADR-0027).
 *
 *   1. TreeCanvas with placeSubject: single tap selects a receiver and shows zones; zone tap
 *      reports relationFromZone via onPlaceZoneChosen (no person-drag).
 *   2. Pan still works during a place session (drag past slop).
 *   3. FamilyTab compact: Place starts a canvas session (no unlocked modal); desktop still opens modal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { KinshipTreeData, TreeNode, UnplacedMember } from "@chronicle/core";
import { TreeCanvas } from "./tree-canvas";
import { FamilyTab } from "../tabs/FamilyTab";
import { UnplacedMembers } from "../tabs/UnplacedMembers";
import { DRAG_SLOP_PX } from "./tree-constants";

afterEach(cleanup);

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

const FOCUS = "p-self";

function selfWithChild(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, displayName: "You", relationToRoot: "self" }),
      node({ personId: "marco", displayName: "Marco", relationToRoot: "child" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: FOCUS,
        personBId: "marco",
        nature: "biological",
        state: "asserted",
        assertedBy: FOCUS,
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
}

function tapCard(personId: string) {
  const el = screen.getByTestId(`tree-node-pos-${personId}`);
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId: 1, timeStamp: 1 });
}

describe("TreeCanvas mobile place zones (#288)", () => {
  it("Place session: tap person → zones → zone reports relationFromZone (no drag placement)", () => {
    const onPlaceZoneChosen = vi.fn();
    render(
      <TreeCanvas
        familyId="F"
        focusPersonId={FOCUS}
        viewerPersonId={FOCUS}
        initial={selfWithChild()}
        fetchSubtree={vi.fn(async () => ({ ok: false as const, error: "failed" as const }))}
        placeSubject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
        onPlaceZoneChosen={onPlaceZoneChosen}
      />,
    );

    expect(screen.queryByTestId("place-zones-marco")).toBeNull();
    tapCard("marco");
    expect(screen.getByTestId("place-zones-marco")).toBeTruthy();

    fireEvent.click(screen.getByTestId("place-zone-bottom"));
    expect(onPlaceZoneChosen).toHaveBeenCalledTimes(1);
    expect(onPlaceZoneChosen).toHaveBeenCalledWith({
      receiverPersonId: "marco",
      receiverDisplayName: "Marco",
      zone: "bottom",
      relation: "child",
    });
  });

  it("side zone maps to partner; pan during place session still moves the camera", () => {
    const onPlaceZoneChosen = vi.fn();
    render(
      <TreeCanvas
        familyId="F"
        focusPersonId={FOCUS}
        viewerPersonId={FOCUS}
        initial={selfWithChild()}
        fetchSubtree={vi.fn(async () => ({ ok: false as const, error: "failed" as const }))}
        placeSubject={{ kind: "mint" }}
        onPlaceZoneChosen={onPlaceZoneChosen}
      />,
    );

    const viewport = screen.getByTestId("tree-viewport");
    const before = screen.getByTestId("tree-pan-layer").style.transform;
    fireEvent.pointerDown(viewport, { clientX: 40, clientY: 40, pointerId: 2 });
    fireEvent.pointerMove(viewport, {
      clientX: 40 + DRAG_SLOP_PX + 20,
      clientY: 40 + 10,
      pointerId: 2,
    });
    fireEvent.pointerUp(viewport, { clientX: 60, clientY: 50, pointerId: 2 });
    const after = screen.getByTestId("tree-pan-layer").style.transform;
    expect(after).not.toBe(before);

    tapCard(FOCUS);
    fireEvent.click(screen.getByTestId("place-zone-side-left"));
    expect(onPlaceZoneChosen).toHaveBeenCalledWith(
      expect.objectContaining({ zone: "side", relation: "partner", receiverPersonId: FOCUS }),
    );
  });

  it("ignores anonymous bridge taps during Place session (no zones)", () => {
    const onPlaceZoneChosen = vi.fn();
    const withBridge: KinshipTreeData = {
      familyId: "F",
      rootPersonId: FOCUS,
      nodes: [
        node({ personId: FOCUS, displayName: "You", relationToRoot: "self" }),
        node({
          personId: "bridge",
          displayName: null,
          identified: false,
          relationToRoot: "parent",
        }),
      ],
      edges: [
        {
          edgeType: "parent_of",
          personAId: "bridge",
          personBId: FOCUS,
          nature: null,
          state: "asserted",
          assertedBy: FOCUS,
          assertedAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
    };
    render(
      <TreeCanvas
        familyId="F"
        focusPersonId={FOCUS}
        viewerPersonId={FOCUS}
        initial={withBridge}
        fetchSubtree={vi.fn(async () => ({ ok: false as const, error: "failed" as const }))}
        placeSubject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
        onPlaceZoneChosen={onPlaceZoneChosen}
      />,
    );

    expect(screen.getByTestId("tree-node-pos-bridge")).toBeTruthy();
    tapCard("bridge");
    expect(screen.queryByTestId("place-zones-bridge")).toBeNull();
    expect(onPlaceZoneChosen).not.toHaveBeenCalled();

    tapCard(FOCUS);
    expect(screen.getByTestId(`place-zones-${FOCUS}`)).toBeTruthy();
  });
});

// FamilyTab compact wiring — mock useIsCompact like family-tab.test.tsx.
let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({ useIsCompact: () => compact }));

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
vi.mock("./actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions")>();
  return { ...actual, listPersonKinOptionsAction };
});

const MEMBERS: UnplacedMember[] = [
  { personId: "u1", displayName: "Rosa Esposito", role: "member" },
];

describe("FamilyTab compact Place→tap (#288)", () => {
  afterEach(() => {
    compact = false;
    refresh.mockReset();
  });

  it("compact Place starts canvas session (no unlocked modal); zone opens locked confirm", async () => {
    compact = true;
    render(
      <FamilyTab
        familyId="F"
        focusPersonId={FOCUS}
        viewerPersonId={FOCUS}
        tree={selfWithChild()}
        listPeople={[]}
        unplaced={MEMBERS}
        viewerIsSteward={false}
        view="tree"
        surface={{ active: "tree", familiesParam: null, showRequests: false }}
      />,
    );

    act(() => screen.getByTestId("unplaced-place-u1").click());
    expect(screen.queryByTestId("place-confirm-modal")).toBeNull();
    expect(screen.getByTestId("mobile-place-hint")).toBeTruthy();

    tapCard("marco");
    expect(screen.getByTestId("place-zones-marco")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId("place-zone-top"));
    });

    const modal = await screen.findByTestId("place-confirm-modal");
    expect(modal).toBeTruthy();
    // Locked receiver path — read-only field, not a free-pick <select>.
    const receiver = within(modal).getByTestId("place-confirm-receiver");
    expect(receiver.tagName).not.toBe("SELECT");
    expect(receiver.textContent).toContain("Marco");
    const relation = within(modal).getByTestId("place-confirm-relation") as HTMLSelectElement;
    expect(relation.value).toBe("parent");
  });

  it("wide viewport Place still opens unlocked receiver modal (desktop path untouched)", async () => {
    compact = false;
    render(
      <FamilyTab
        familyId="F"
        focusPersonId={FOCUS}
        viewerPersonId={FOCUS}
        tree={selfWithChild()}
        listPeople={[]}
        unplaced={MEMBERS}
        viewerIsSteward={false}
        view="tree"
        surface={{ active: "tree", familiesParam: null, showRequests: false }}
      />,
    );

    act(() => screen.getByTestId("unplaced-place-u1").click());
    const modal = await screen.findByTestId("place-confirm-modal");
    expect(modal).toBeTruthy();
    expect(screen.queryByTestId("mobile-place-hint")).toBeNull();
    // Unlocked tray path fetches anchors (locked zone path never shows this).
    expect(within(modal).getByTestId("place-confirm-loading-anchors")).toBeTruthy();
  });
});

describe("UnplacedMembers canvas place hook (#288)", () => {
  it("onStartCanvasPlace is used instead of opening the unlocked modal", () => {
    const onStart = vi.fn();
    render(
      <UnplacedMembers
        familyId="F"
        members={MEMBERS}
        viewerIsSteward={false}
        onStartCanvasPlace={onStart}
        onFetchAnchors={vi.fn(async () => ({ ok: true as const, persons: [] }))}
      />,
    );
    act(() => screen.getByTestId("unplaced-place-u1").click());
    expect(onStart).toHaveBeenCalledWith({
      kind: "link",
      personId: "u1",
      displayName: "Rosa Esposito",
    });
    expect(screen.queryByTestId("place-confirm-modal")).toBeNull();
  });
});
