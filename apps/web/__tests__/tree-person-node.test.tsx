// @vitest-environment jsdom
/**
 * PersonNode — uniform card, ego-centric redesign (spec §2): Avatar · Name · Dates. No "You" label,
 * no root distinction, dates-only (no "in memory", no muted tint), sex bar kept, dashed anonymous
 * bridge. Avatar = photo → monogram → "?". Also covers deterministic monogram color from personId.
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { PersonNode, datesLineFor, monogramColor } from "@/app/hub/tree/person-node";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
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

it("renders a living person with name and open date range (dates only)", () => {
  render(<PersonNode node={node({ personId: "p1", displayName: "Marco", birthYear: 1980 })} />);
  const card = screen.getByTestId("tree-node-p1");
  expect(card.textContent).toContain("Marco");
  expect(card.textContent).toContain("1980–");
  // No "You" label, no relation line, no "in memory".
  expect(card.textContent).not.toContain("You");
  expect(card.textContent).not.toContain("In memory");
});

it("renders a deceased person with a full closed date range (no 'in memory')", () => {
  render(
    <PersonNode node={node({ personId: "p2", displayName: "Rosa", lifeStatus: "deceased", birthYear: 1920, deathYear: 1998 })} />,
  );
  const card = screen.getByTestId("tree-node-p2");
  expect(card.textContent).toContain("1920–1998");
  expect(card.textContent).not.toContain("In memory");
});

it("degrades dates gracefully when a year is unknown", () => {
  expect(datesLineFor(node({ personId: "a", lifeStatus: "deceased", birthYear: 1948, deathYear: null }))).toBe("1948–");
  expect(datesLineFor(node({ personId: "b", lifeStatus: "deceased", birthYear: null, deathYear: 1998 }))).toBe("–1998");
  expect(datesLineFor(node({ personId: "c", lifeStatus: "deceased", birthYear: null, deathYear: null }))).toBe("");
  expect(datesLineFor(node({ personId: "d", lifeStatus: "living", birthYear: 1948 }))).toBe("1948–");
  expect(datesLineFor(node({ personId: "e", lifeStatus: "living", birthYear: null }))).toBe("");
});

it("shows a monogram avatar (first initial) when there is no photo", () => {
  render(<PersonNode node={node({ personId: "p3", displayName: "Nonna" })} />);
  expect(screen.getByTestId("tree-node-monogram-p3").textContent).toBe("N");
});

it("shows a photo avatar when the node carries an image url", () => {
  const withPhoto = { ...node({ personId: "p4", displayName: "Ada" }), imageUrl: "https://x/y.jpg" } as TreeNode;
  render(<PersonNode node={withPhoto} />);
  expect(screen.getByTestId("tree-node-photo-p4")).toBeTruthy();
});

it("renders an anonymous bridge as 'Unknown <relation>' with a ? monogram, no dates", () => {
  render(
    <PersonNode node={node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" })} />,
  );
  const card = screen.getByTestId("tree-node-p-anon");
  expect(card.getAttribute("data-anon")).toBe("true");
  expect(card.textContent).toContain("Unknown grandparent");
  expect(screen.getByTestId("tree-node-monogram-p-anon").textContent).toBe("?");
});

it("renders an identified-but-nameless person as a real (non-bridge) node", () => {
  render(
    <PersonNode node={node({ personId: "p-named-null", displayName: null, identified: true, relationToRoot: "parent" })} />,
  );
  const card = screen.getByTestId("tree-node-p-named-null");
  expect(card.getAttribute("data-anon")).toBeNull();
  expect(card.textContent).toContain("Unknown relative");
  expect(card.textContent).not.toContain("Unknown parent");
});

it("draws a sex color bar for male/female and none for unknown", () => {
  render(<PersonNode node={node({ personId: "p-m", sex: "male" })} />);
  expect(screen.getByTestId("tree-node-sexbar-p-m")).toBeTruthy();
  cleanup();
  render(<PersonNode node={node({ personId: "p-f", sex: "female" })} />);
  expect(screen.getByTestId("tree-node-sexbar-p-f")).toBeTruthy();
  cleanup();
  render(<PersonNode node={node({ personId: "p-u", sex: "unknown" })} />);
  expect(screen.queryByTestId("tree-node-sexbar-p-u")).toBeNull();
});

it("renders an optional per-card kebab affordance when supplied", () => {
  render(<PersonNode node={node({ personId: "p-k" })} kebab={<span data-testid="my-kebab" />} />);
  expect(screen.getByTestId("my-kebab")).toBeTruthy();
});

it("derives a deterministic monogram color from personId", () => {
  expect(monogramColor("abc")).toBe(monogramColor("abc"));
  expect(monogramColor("abc")).not.toBe(monogramColor("xyz"));
  expect(monogramColor("abc")).toMatch(/^hsl\(/);
});
