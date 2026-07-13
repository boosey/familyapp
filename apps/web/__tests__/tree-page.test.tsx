// @vitest-environment jsdom
/**
 * /hub/tree page (ego-centric redesign, spec §1/§1a/§8): the async server component's gates.
 *   - anonymous → redirect to "/"
 *   - no active family → "no family" empty state
 *   - a viewer (even with no kin) → renders <TreeCanvas> (the tree IS the empty state; no CTA page)
 *   - the core read is rooted ON THE FOCUS (the `?anchor=`/`?root=` person), not the viewer
 *   - a genuinely absent/invalid focus param falls back to the viewer's own self-root
 *
 * The data seams (getRuntime, core reads) are mocked; TreeCanvas is stubbed.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";

const getCurrentAuthContext = vi.fn();
const listActiveFamiliesForPerson = vi.fn();
const resolveKinshipTree = vi.fn();

class RedirectError extends Error {
  constructor(public to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: {}, auth: { getCurrentAuthContext } }),
}));
vi.mock("@chronicle/core", async () => {
  const actual = await vi.importActual<typeof import("@chronicle/core")>("@chronicle/core");
  return {
    ...actual,
    listActiveFamiliesForPerson: (...a: unknown[]) => listActiveFamiliesForPerson(...a),
    resolveKinshipTree: (...a: unknown[]) => resolveKinshipTree(...a),
  };
});
vi.mock("@/app/hub/tree/tree-canvas", () => ({
  TreeCanvas: ({ familyId, focusPersonId }: { familyId: string; focusPersonId: string }) => (
    <div data-testid="tree-canvas" data-family={familyId} data-focus={focusPersonId} />
  ),
}));

import TreePage from "@/app/hub/tree/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SELF = "p-self";

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
  };
}

function tree(root: string, nodes: TreeNode[]): KinshipTreeData {
  return { familyId: "fam-1", rootPersonId: root, nodes, edges: [] };
}

async function renderPage(searchParams: { scope?: string; root?: string; anchor?: string }) {
  const el = await TreePage({ searchParams: Promise.resolve(searchParams) });
  return render(el);
}

it("redirects an anonymous visitor to the front door", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "anonymous" });
  await expect(renderPage({})).rejects.toThrow(/REDIRECT:\//);
});

it("shows the no-family empty state when the viewer is in no family", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([]);
  await renderPage({});
  expect(screen.getByText(/Join or start a family/i)).toBeTruthy();
});

it("renders TreeCanvas even for a viewer with no kin (the tree is the empty state)", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  resolveKinshipTree.mockResolvedValue(tree(SELF, [node({ personId: SELF, relationToRoot: "self" })]));
  await renderPage({});
  const canvas = screen.getByTestId("tree-canvas");
  expect(canvas.getAttribute("data-focus")).toBe(SELF);
});

it("roots the read on the VIEWER for a direct visit (no focus param)", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  resolveKinshipTree.mockResolvedValue(
    tree(SELF, [node({ personId: SELF, relationToRoot: "self" }), node({ personId: "p2", relationToRoot: "child" })]),
  );
  await renderPage({ scope: "fam-1" });
  const canvas = screen.getByTestId("tree-canvas");
  expect(canvas.getAttribute("data-family")).toBe("fam-1");
  expect(canvas.getAttribute("data-focus")).toBe(SELF);
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", SELF);
});

it("roots the read on the FOCUS from ?anchor= (a deep-linked relative), NOT the viewer", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  // Rooted on p2, p2 materializes in its own projection ⇒ honored as focus, no viewer fallback.
  resolveKinshipTree.mockImplementation(async (_db, _ctx, _fam, rootId) =>
    tree(rootId, [node({ personId: rootId, relationToRoot: "self" }), node({ personId: SELF, relationToRoot: "parent" })]),
  );
  await renderPage({ scope: "fam-1", anchor: "p2" });
  expect(screen.getByTestId("tree-canvas").getAttribute("data-focus")).toBe("p2");
  // The read was rooted on the FOCUS (p2), and the viewer self-root was NOT needed.
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", "p2");
  expect(resolveKinshipTree).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", SELF);
});

it("falls back to the viewer self-root when ?root= is invalid (empty focus projection)", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  // The core ROOT GUARD returns an empty projection for a bogus/foreign root; then self-root loads.
  resolveKinshipTree.mockImplementation(async (_db, _ctx, _fam, rootId) => {
    if (rootId === "bogus") return tree("bogus", []); // no node for "bogus" ⇒ invalid
    return tree(SELF, [node({ personId: SELF, relationToRoot: "self" })]);
  });
  await renderPage({ scope: "fam-1", root: "bogus" });
  expect(screen.getByTestId("tree-canvas").getAttribute("data-focus")).toBe(SELF);
  // Tried the invalid focus first, then fell back to the viewer.
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", "bogus");
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", SELF);
});
