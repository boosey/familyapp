// @vitest-environment jsdom
/**
 * /hub/tree page (spec §3/§9): the async server component's gates and empty states.
 *   - anonymous → redirect to "/"
 *   - no active family → "no family" empty state
 *   - root-only (no kin) → the root-only CTA linking to /hub/kin
 *   - a populated projection → renders <TreeCanvas> with the resolved family + root
 *   - an invalid ?root= → falls back to the viewer's own person
 *
 * The data seams (getRuntime, core reads) are mocked; TreeCanvas is stubbed so we don't pull the
 * server action / DB into the render.
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
  TreeCanvas: ({ familyId, rootPersonId }: { familyId: string; rootPersonId: string }) => (
    <div data-testid="tree-canvas" data-family={familyId} data-root={rootPersonId} />
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

async function renderPage(searchParams: { scope?: string; root?: string }) {
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

it("shows the root-only CTA when the viewer has no kin", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  resolveKinshipTree.mockResolvedValue(tree(SELF, [node({ personId: SELF, relationToRoot: "self" })]));
  await renderPage({});
  expect(screen.getByText(/only person here/i)).toBeTruthy();
  const cta = screen.getByRole("link", { name: /Add a relative/i });
  expect(cta.getAttribute("href")).toBe("/hub/kin");
});

it("renders TreeCanvas for a populated projection", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  resolveKinshipTree.mockResolvedValue(
    tree(SELF, [node({ personId: SELF, relationToRoot: "self" }), node({ personId: "p2", relationToRoot: "child" })]),
  );
  await renderPage({ scope: "fam-1" });
  const canvas = screen.getByTestId("tree-canvas");
  expect(canvas.getAttribute("data-family")).toBe("fam-1");
  expect(canvas.getAttribute("data-root")).toBe(SELF);
});

it("falls back to the viewer's own person when ?root= is not a node in the projection", async () => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: SELF });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: "fam-1", familyName: "Esposito" }]);
  // First call (requested bad root) returns a projection WITHOUT that root node ⇒ invalid.
  resolveKinshipTree.mockImplementation(async (_db, _ctx, _fam, rootId) => {
    if (rootId === "bogus") return tree(SELF, [node({ personId: SELF, relationToRoot: "self" })]);
    return tree(SELF, [node({ personId: SELF, relationToRoot: "self" }), node({ personId: "p2", relationToRoot: "child" })]);
  });
  await renderPage({ scope: "fam-1", root: "bogus" });
  const canvas = screen.getByTestId("tree-canvas");
  expect(canvas.getAttribute("data-root")).toBe(SELF);
  // The invalid root was tried, then self was loaded.
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", "bogus");
  expect(resolveKinshipTree).toHaveBeenCalledWith(expect.anything(), expect.anything(), "fam-1", SELF);
});
