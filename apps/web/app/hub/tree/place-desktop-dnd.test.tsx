// @vitest-environment jsdom
/**
 * Desktop tray → card-zone DnD (#287) — zones appear while a place-drag is active; drop opens
 * shared PlaceConfirmModal with locked receiver + relationFromZone. No DnD physics coverage.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "./actions";
import { TreeCanvas } from "./tree-canvas";
import { setActivePlaceDrag } from "./place-drag";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

afterEach(() => {
  cleanup();
  setActivePlaceDrag(null);
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
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
  };
}

const FOCUS = "p-self";
const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

function selfWithChild(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, displayName: "Sofia", relationToRoot: "self" }),
      node({ personId: "marco", displayName: "Marco", relationToRoot: "child" }),
      node({
        personId: "anon",
        displayName: null,
        identified: false,
        relationToRoot: "parent",
      }),
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

it("#287: no card zones until a tray place-drag is active (pan path undisturbed)", () => {
  render(
    <TreeCanvas
      familyId="F"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithChild()}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  expect(screen.queryByTestId(`card-drop-zones-${FOCUS}`)).toBeNull();
});

it("#287: active place-drag shows zones on identified cards only; side = partner", async () => {
  render(
    <TreeCanvas
      familyId="F"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithChild()}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  act(() => {
    setActivePlaceDrag({ kind: "link", personId: "u1", displayName: "Rosa" });
  });

  expect(screen.getByTestId(`card-drop-zones-${FOCUS}`)).toBeTruthy();
  expect(screen.getByTestId(`card-drop-zones-marco`)).toBeTruthy();
  expect(screen.queryByTestId("card-drop-zones-anon")).toBeNull();

  expect(screen.getByTestId(`card-drop-zone-${FOCUS}-top`).getAttribute("data-zone")).toBe("top");
  expect(screen.getByTestId(`card-drop-zone-${FOCUS}-bottom`).getAttribute("data-zone")).toBe(
    "bottom",
  );
  expect(screen.getByTestId(`card-drop-zone-${FOCUS}-left`).getAttribute("data-zone")).toBe("side");
  expect(screen.getByTestId(`card-drop-zone-${FOCUS}-right`).getAttribute("data-zone")).toBe(
    "side",
  );
});

it("#287: drop on top opens PlaceConfirmModal with locked receiver + parent relation", async () => {
  render(
    <TreeCanvas
      familyId="F"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithChild()}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  act(() => {
    setActivePlaceDrag({ kind: "link", personId: "u1", displayName: "Rosa" });
  });

  await act(async () => {
    fireEvent.drop(screen.getByTestId(`card-drop-zone-${FOCUS}-top`));
  });

  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  const receiver = screen.getByTestId("place-confirm-receiver");
  expect(receiver.tagName).not.toBe("SELECT");
  expect(receiver.textContent).toMatch(/Sofia/);
  expect(screen.getByTestId("place-confirm-subject").textContent).toMatch(/Rosa/);
  expect((screen.getByTestId("place-confirm-relation") as HTMLSelectElement).value).toBe("parent");
  // Drop cleared the active drag → zones gone (pan/zoom path free again).
  expect(screen.queryByTestId(`card-drop-zones-${FOCUS}`)).toBeNull();
});

it("#287: drop on side pre-fills partner; mint subject opens name field", async () => {
  render(
    <TreeCanvas
      familyId="F"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithChild()}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  act(() => {
    setActivePlaceDrag({ kind: "mint" });
  });

  await act(async () => {
    fireEvent.drop(screen.getByTestId(`card-drop-zone-marco-right`));
  });

  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  expect(screen.getByTestId("place-confirm-name")).toBeTruthy();
  expect(screen.getByTestId("place-confirm-receiver").textContent).toMatch(/Marco/);
  expect((screen.getByTestId("place-confirm-relation") as HTMLSelectElement).value).toBe("partner");
});
