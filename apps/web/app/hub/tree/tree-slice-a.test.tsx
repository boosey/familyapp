// @vitest-environment jsdom
/**
 * Tree Slice A regression tests (spec §8):
 *   1. A drag STARTING ON A CARD pans the canvas (does not open the details sheet).
 *   2. A double-click on a card opens the read-only details sheet; a single click does not.
 *   3. Re-focus via the kebab Focus action changes relation chips + the ring but leaves the camera
 *      put — the newly-focused card keeps its on-screen position (pan-delta cancels the anchor jump;
 *      scale is untouched). A fake fetchSubtree is injected.
 *   4. The relation chip renders `relationToRoot`; the focus card is blank; the viewer card = "You".
 *   5. The focus ring renders in the focus person's sex color and MOVES on re-focus; unknown → neutral.
 *
 * (Item 6 — Fit/zoom controls live in the selector row and the list view hides them — is covered in
 * __tests__/tree-zoom.test.tsx, which drives them through FamilyTab.)
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "./actions";
import { hub } from "@/app/_copy";
import { TreeCanvas } from "./tree-canvas";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

const FOCUS = "p-self";
const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

/** Focus "p-self" with one drawn child "marco". */
function selfWithChild(overrides: Partial<Record<"self" | "child", Partial<TreeNode>>> = {}): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, relationToRoot: "self", ...overrides.self }),
      node({ personId: "marco", displayName: "Marco", relationToRoot: "child", ...overrides.child }),
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

// Read the pan-layer transform parts: pan, scale, and the negated camera anchor.
function transformParts(): { pan: { x: number; y: number }; scale: number; negAnchor: { x: number; y: number } } {
  const layer = screen.getByTestId("tree-pan-layer");
  const t = layer.style.transform;
  const translates = [...t.matchAll(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/g)];
  const scaleM = /scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
  return {
    pan: { x: parseFloat(translates[0]![1]!), y: parseFloat(translates[0]![2]!) },
    scale: scaleM ? parseFloat(scaleM[1]!) : 1,
    negAnchor: { x: parseFloat(translates[1]![1]!), y: parseFloat(translates[1]![2]!) },
  };
}

// On-screen position of a placed card (base offset is a constant left:50%, so it cancels in deltas).
function screenPosOf(personId: string): { x: number; y: number } {
  const { pan, scale, negAnchor } = transformParts();
  const pos = screen.getByTestId(`tree-node-pos-${personId}`);
  const lx = parseFloat(pos.style.left);
  const ly = parseFloat(pos.style.top);
  return { x: pan.x + scale * (lx + negAnchor.x), y: pan.y + scale * (ly + negAnchor.y) };
}

// ---- 1. Drag from a card pans, doesn't open details -------------------------------------------
it("a drag starting ON A CARD pans the canvas and does not open details", async () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={vi.fn(noFetch)} />);
  const before = transformParts().pan;
  const cardPos = screen.getByTestId("tree-node-pos-marco");
  await act(async () => {
    fireEvent.pointerDown(cardPos, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(cardPos, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(cardPos, { clientX: 160, clientY: 130, pointerId: 1 });
  });
  const after = transformParts().pan;
  // Pan followed the pointer delta (+60, +30); the drag never opened the details sheet.
  expect(after.x - before.x).toBeCloseTo(60, 3);
  expect(after.y - before.y).toBeCloseTo(30, 3);
  expect(screen.queryByTestId("tree-person-details")).toBeNull();
});

// ---- 2. Double-click opens details; single click does not -------------------------------------
it("double-click opens the details sheet; a single click does not", async () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={vi.fn(noFetch)} />);
  const cardPos = screen.getByTestId("tree-node-pos-marco");

  // Single click — no sheet.
  await act(async () => {
    fireEvent.pointerDown(cardPos, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(cardPos, { clientX: 5, clientY: 5, pointerId: 1 });
  });
  expect(screen.queryByTestId("tree-person-details")).toBeNull();

  // Double click — sheet opens.
  await act(async () => {
    fireEvent.doubleClick(cardPos);
  });
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();
});

it("two quick taps on the same card open the details sheet (double-tap path)", async () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={vi.fn(noFetch)} />);
  const cardPos = screen.getByTestId("tree-node-pos-marco");
  await act(async () => {
    fireEvent.pointerDown(cardPos, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(cardPos, { clientX: 5, clientY: 5, pointerId: 1, timeStamp: 100 });
    fireEvent.pointerDown(cardPos, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(cardPos, { clientX: 5, clientY: 5, pointerId: 1, timeStamp: 250 });
  });
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();
});

it("does NOT capture the pointer on a tap, only once a drag crosses the slop (regression: Gemini #2)", async () => {
  // Capturing the pointer on pointerdown routes every later pointer event (incl. pointerup) to the
  // viewport, so cards never see their own pointerup — silently breaking double-tap on real browsers
  // (jsdom dispatches directly to a node, so it can't observe the routing; we assert the mechanism).
  const proto = HTMLElement.prototype as unknown as { setPointerCapture?: (id: number) => void };
  const orig = proto.setPointerCapture;
  const captureSpy = vi.fn();
  proto.setPointerCapture = captureSpy;
  try {
    render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={vi.fn(noFetch)} />);
    const cardPos = screen.getByTestId("tree-node-pos-marco");
    // A tap (sub-slop move) must NOT capture — the pointerup has to reach the card for double-tap.
    await act(async () => {
      fireEvent.pointerDown(cardPos, { clientX: 5, clientY: 5, pointerId: 1 });
      fireEvent.pointerMove(cardPos, { clientX: 7, clientY: 6, pointerId: 1 }); // hypot ≈ 2.2 < DRAG_SLOP_PX
      fireEvent.pointerUp(cardPos, { clientX: 7, clientY: 6, pointerId: 1 });
    });
    expect(captureSpy).not.toHaveBeenCalled();
    // A real pan (move past the slop) DOES capture so the drag tracks smoothly.
    await act(async () => {
      fireEvent.pointerDown(cardPos, { clientX: 5, clientY: 5, pointerId: 2 });
      fireEvent.pointerMove(cardPos, { clientX: 60, clientY: 60, pointerId: 2 });
      fireEvent.pointerUp(cardPos, { clientX: 60, clientY: 60, pointerId: 2 });
    });
    expect(captureSpy).toHaveBeenCalled();
  } finally {
    proto.setPointerCapture = orig;
  }
});

// ---- 3. Re-focus keeps the camera put -----------------------------------------------------------
it("re-focus via the kebab holds the newly-focused card's screen position (camera still) and keeps scale", async () => {
  const fetchSubtree = vi.fn(noFetch);
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={fetchSubtree} />);

  const marcoBefore = screenPosOf("marco");
  const scaleBefore = transformParts().scale;

  // Open marco's kebab and click Focus.
  const kebabTrigger = screen.getByTestId("tree-node-pos-marco").querySelector('[data-testid="tree-kebab-trigger"]')!;
  await act(async () => fireEvent.click(kebabTrigger));
  await act(async () => fireEvent.click(screen.getByTestId("tree-kebab-focus")));

  // marco is now the focus; its on-screen position is unchanged (pan-delta cancelled the anchor jump).
  const marcoAfter = screenPosOf("marco");
  expect(marcoAfter.x).toBeCloseTo(marcoBefore.x, 3);
  expect(marcoAfter.y).toBeCloseTo(marcoBefore.y, 3);
  // Scale untouched by a re-focus.
  expect(transformParts().scale).toBeCloseTo(scaleBefore, 5);
  // A re-focus IS a server re-root — the injected fetch was called for the new focus.
  expect(fetchSubtree).toHaveBeenCalledWith("F", "marco");
});

it("re-focus recomputes the relation chips from the re-rooted projection: the new focus goes blank", async () => {
  // The Focus action is a SERVER re-root: it refetches a projection rooted on the new focus. We inject
  // a fake fetch that returns that marco-rooted projection (marco → self, p-self → parent), so the
  // chips recompute exactly as they would in prod. Without the refetch the chips would stay stale — the
  // chip is server-derived (relationToRoot), unlike the client-only ring in the test above.
  const marcoRooted: KinshipTreeData = {
    familyId: "F",
    rootPersonId: "marco",
    nodes: [
      node({ personId: "marco", displayName: "Marco", relationToRoot: "self" }),
      node({ personId: FOCUS, relationToRoot: "parent" }),
    ],
    edges: [
      { edgeType: "parent_of", personAId: FOCUS, personBId: "marco", nature: "biological", state: "asserted", assertedBy: FOCUS, assertedAt: new Date(0), updatedAt: new Date(0) },
    ],
  };
  const fetchSubtree = vi.fn(async (): Promise<FetchSubtreeResult> => ({ ok: true, data: marcoRooted }));
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={selfWithChild()} fetchSubtree={fetchSubtree} />);
  // Before: viewer IS the focus, so its own card reads "You"; marco (a child) shows its relation chip.
  expect(screen.getByTestId(`tree-node-chip-marco`).textContent).toBe(hub.kin.relationLabel.child);

  const kebabTrigger = screen.getByTestId("tree-node-pos-marco").querySelector('[data-testid="tree-kebab-trigger"]')!;
  await act(async () => fireEvent.click(kebabTrigger));
  await act(async () => fireEvent.click(screen.getByTestId("tree-kebab-focus")));

  // After: marco is the focus (relationToRoot === "self") → blank; p-self, no longer the viewer's focus
  // but still the viewer, keeps "You". marco's chip is gone; p-self now reads its relation as "You".
  await waitFor(() => expect(screen.queryByTestId("tree-node-chip-marco")).toBeNull());
  expect(screen.getByTestId(`tree-node-chip-${FOCUS}`).textContent).toBe(hub.tree.youLabel);
});

// ---- 4. Relation chip / focus-blank / viewer "You" ---------------------------------------------
it("renders relationToRoot as the chip; focus card is blank; viewer card reads 'You'", () => {
  // Viewer is a THIRD person (not the focus) so we can see all three states at once. Fixture: focus
  // p-self, a child marco, and the viewer 'vguy' as focus's parent.
  const data: KinshipTreeData = {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, relationToRoot: "self" }),
      node({ personId: "marco", displayName: "Marco", relationToRoot: "child" }),
      node({ personId: "vguy", displayName: "Val", relationToRoot: "parent" }),
    ],
    edges: [
      { edgeType: "parent_of", personAId: FOCUS, personBId: "marco", nature: "biological", state: "asserted", assertedBy: FOCUS, assertedAt: new Date(0), updatedAt: new Date(0) },
      { edgeType: "parent_of", personAId: "vguy", personBId: FOCUS, nature: "biological", state: "asserted", assertedBy: FOCUS, assertedAt: new Date(0), updatedAt: new Date(0) },
    ],
  };
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId="vguy" initial={data} fetchSubtree={vi.fn(noFetch)} />);

  // Focus card → blank (no chip element).
  expect(screen.queryByTestId(`tree-node-chip-${FOCUS}`)).toBeNull();
  // Ordinary card → its relation-to-focus label.
  expect(screen.getByTestId("tree-node-chip-marco").textContent).toBe(hub.kin.relationLabel.child);
  // Viewer card → "You" (over-rides the "parent" relation).
  expect(screen.getByTestId("tree-node-chip-vguy").textContent).toBe(hub.tree.youLabel);
});

// ---- 5. Focus ring color + it moves; unknown → neutral -----------------------------------------
function ringShadowOf(personId: string): string {
  return (screen.getByTestId(`tree-node-${personId}`) as HTMLElement).style.boxShadow;
}

it("the focus ring renders in the focus person's sex color and moves on re-focus; unknown → neutral", async () => {
  // Focus (male) with a female child. The focus card carries a ring in --sex-male; marco has none.
  const data = selfWithChild({ self: { sex: "male" }, child: { sex: "female" } });
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={data} fetchSubtree={vi.fn(noFetch)} />);

  expect(ringShadowOf(FOCUS)).toContain("var(--sex-male)");
  expect(ringShadowOf("marco")).toBe(""); // no ring on a non-focus card

  // Re-focus onto marco (female) → the ring moves to marco in --sex-female; the old focus loses it.
  const kebabTrigger = screen.getByTestId("tree-node-pos-marco").querySelector('[data-testid="tree-kebab-trigger"]')!;
  await act(async () => fireEvent.click(kebabTrigger));
  await act(async () => fireEvent.click(screen.getByTestId("tree-kebab-focus")));

  await waitFor(() => expect(ringShadowOf("marco")).toContain("var(--sex-female)"));
  expect(ringShadowOf(FOCUS)).toBe("");
});

it("an unknown-sex focus person gets a neutral ring (--border-strong)", () => {
  const data = selfWithChild({ self: { sex: "unknown" } });
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={data} fetchSubtree={vi.fn(noFetch)} />);
  expect(ringShadowOf(FOCUS)).toContain("var(--border-strong)");
});
