// @vitest-environment jsdom
/**
 * PersonNode — the four visual states (spec §8): You, living, deceased (life span / in memory),
 * anonymous bridge ("Unknown <relation>"). Also covers deterministic monogram color from personId.
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { PersonNode, monogramColor, relationToRootLabel } from "@/app/hub/tree/person-node";
import { hub } from "@/app/_copy";

afterEach(cleanup);

const makeNode = node;

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    // Respect an explicit `null` (don't clobber it with the default via `??`).
    displayName: "displayName" in over ? (over.displayName ?? null) : "Eleanor",
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? "parent",
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
    sex: over.sex ?? "unknown",
  };
}

it("renders the You node with an accent root marker and 'You' label", () => {
  render(
    <PersonNode node={node({ personId: "p-self", relationToRoot: "self", birthYear: 1948 })} isRoot viewerPersonId="p-self" />,
  );
  const card = screen.getByTestId("tree-node-p-self");
  expect(card.getAttribute("data-root")).toBe("true");
  expect(card.textContent).toContain("You");
  expect(card.textContent).toContain("b. 1948");
});

it("renders a living relative with relation and birth year", () => {
  render(
    <PersonNode node={node({ personId: "p1", displayName: "Marco", relationToRoot: "child", birthYear: 1980 })} isRoot={false} />,
  );
  const card = screen.getByTestId("tree-node-p1");
  expect(card.textContent).toContain("Marco");
  expect(card.textContent).toContain("Child");
  expect(card.textContent).toContain("b. 1980");
  expect(card.getAttribute("data-deceased")).toBeNull();
});

it("renders a deceased relative with a full life span and 'In memory'", () => {
  render(
    <PersonNode
      node={node({ personId: "p2", displayName: "Rosa", lifeStatus: "deceased", birthYear: 1920, deathYear: 1998 })}
      isRoot={false}
    />,
  );
  const card = screen.getByTestId("tree-node-p2");
  expect(card.getAttribute("data-deceased")).toBe("true");
  expect(card.textContent).toContain("1920–1998");
  expect(card.textContent).toContain("In memory");
});

it("renders a deceased relative with only 'In memory' when no years are known", () => {
  render(
    <PersonNode
      node={node({ personId: "p3", displayName: "Nonno", lifeStatus: "deceased", birthYear: null, deathYear: null })}
      isRoot={false}
    />,
  );
  const card = screen.getByTestId("tree-node-p3");
  expect(card.textContent).toContain("In memory");
  expect(card.textContent).not.toContain("–");
});

it("renders an anonymous bridge as 'Unknown <relation>' with a ? monogram", () => {
  render(
    <PersonNode
      node={node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" })}
      isRoot={false}
    />,
  );
  const card = screen.getByTestId("tree-node-p-anon");
  expect(card.getAttribute("data-anon")).toBe("true");
  expect(card.textContent).toContain("Unknown grandparent");
  expect(card.textContent).toContain("?");
});

it("renders an identified-but-nameless person as a real (non-bridge) node, not an anonymous bridge", () => {
  // Regression (cold-review #1): identified===true with a null displayName is a REAL person (a known
  // #30 nullable-name deviation) — it must NOT get the dashed/italic/"Unknown <relation>" bridge
  // treatment reserved for identified===false. It shows the generic "Unknown relative" label instead.
  render(
    <PersonNode
      node={node({ personId: "p-named-null", displayName: null, identified: true, relationToRoot: "parent" })}
      isRoot={false}
    />,
  );
  const card = screen.getByTestId("tree-node-p-named-null");
  expect(card.getAttribute("data-anon")).toBeNull(); // NOT flagged anonymous
  expect(card.textContent).toContain("Unknown relative");
  expect(card.textContent).not.toContain("Unknown parent"); // no relation-derived bridge label
});

it("labels the viewer's own node 'You' even when it is not the root", () => {
  const n = makeNode({ personId: "viewer", relationToRoot: "parent" });
  expect(relationToRootLabel(n, /*isRoot*/ false, /*viewerPersonId*/ "viewer")).toBe(hub.tree.you);
});

it("labels the viewer 'You' when it IS the root", () => {
  const n = makeNode({ personId: "viewer", relationToRoot: "self" });
  expect(relationToRootLabel(n, true, "viewer")).toBe(hub.tree.you);
});

it("labels a re-rooted non-viewer by relation, not 'You'", () => {
  const n = makeNode({ personId: "marco", relationToRoot: "self" }); // root but not viewer
  expect(relationToRootLabel(n, true, "viewer")).toBe(""); // focal root, not viewer => no relation line
});

it("labels a non-root non-viewer by relation", () => {
  const n = makeNode({ personId: "marco", relationToRoot: "child" });
  expect(relationToRootLabel(n, false, "viewer")).toBe(hub.kin.relationLabel.child);
});

it("draws a sex color bar for male/female and none for unknown", () => {
  render(<PersonNode node={node({ personId: "p-m", sex: "male" })} isRoot={false} />);
  expect(screen.getByTestId("tree-node-sexbar-p-m")).toBeTruthy();
  cleanup();
  render(<PersonNode node={node({ personId: "p-f", sex: "female" })} isRoot={false} />);
  expect(screen.getByTestId("tree-node-sexbar-p-f")).toBeTruthy();
  cleanup();
  render(<PersonNode node={node({ personId: "p-u", sex: "unknown" })} isRoot={false} />);
  expect(screen.queryByTestId("tree-node-sexbar-p-u")).toBeNull();
});

it("renders an optional per-card kebab affordance when supplied", () => {
  render(
    <PersonNode
      node={node({ personId: "p-k" })}
      isRoot={false}
      kebab={<span data-testid="my-kebab" />}
    />,
  );
  expect(screen.getByTestId("my-kebab")).toBeTruthy();
});

it("derives a deterministic monogram color from personId", () => {
  expect(monogramColor("abc")).toBe(monogramColor("abc"));
  expect(monogramColor("abc")).not.toBe(monogramColor("xyz"));
  expect(monogramColor("abc")).toMatch(/^hsl\(/);
});
