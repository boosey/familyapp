// @vitest-environment jsdom
/**
 * #328 — details-sheet read-only header gets a monogram AVATAR, and the four icon actions get native
 * `title` tooltips. Companion regression coverage for the avatar-and-tooltips change.
 *
 * The avatar reuses the tree card's monogram helpers (same initial + deterministic color), so a named
 * node shows its initial and a nameless/anonymous node shows "?". Tooltips reuse the existing aria copy.
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { PersonDetails } from "./person-details";
import { monogramColor } from "./person-node";
import type { PersonEditabilityResult, SavePersonEditResult } from "./actions";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? null,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

const editableYes = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: true });
const editableNo = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: false });
const saveOk = async (): Promise<SavePersonEditResult> => ({ ok: true });

it("renders the monogram avatar (initial + deterministic color) for a named node", async () => {
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableNo}
      saveEdit={saveOk}
    />,
  );
  const avatar = await screen.findByTestId("tree-details-avatar");
  expect(avatar.textContent).toBe("A");
  // Deterministic per-person background (jsdom serializes the helper's HSL to rgb) — a stable, distinct
  // color, not the flat brand accent. `monogramColor` purity is covered by its own unit.
  const bg = avatar.style.background;
  expect(bg).not.toBe("");
  expect(bg).toBe(probeHsl(monogramColor("p1")));
});

/** Serialize an hsl(...) string the way jsdom stores it on `element.style.background` (rgb). */
function probeHsl(hsl: string): string {
  const el = document.createElement("div");
  el.style.background = hsl;
  return el.style.background;
}

it('renders a "?" avatar for a nameless / anonymous node', async () => {
  render(
    <PersonDetails
      node={node({ personId: "bridge", displayName: null, identified: false })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableNo}
      saveEdit={saveOk}
    />,
  );
  const avatar = await screen.findByTestId("tree-details-avatar");
  expect(avatar.textContent).toBe("?");
  // Anonymous bridge → neutral fill, matching the tree card (NOT a hashed monogram color).
  expect(avatar.style.background).toBe("var(--border-strong)");
  expect(avatar.style.background).not.toBe(probeHsl(monogramColor("bridge")));
});

it("gives each icon action a native title tooltip equal to its label copy", async () => {
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableYes}
      saveEdit={saveOk}
    />,
  );
  // Edit appears only once the editability probe resolves.
  expect((await screen.findByTestId("tree-details-edit")).getAttribute("title")).toBe(
    hub.tree.editButton,
  );
  expect(screen.getByTestId("tree-details-stories").getAttribute("title")).toBe(
    hub.tree.detailsStories,
  );
  expect(screen.getByTestId("tree-details-photos").getAttribute("title")).toBe(
    hub.tree.detailsPhotos,
  );
  expect(screen.getByTestId("tree-details-mentions").getAttribute("title")).toBe(
    hub.tree.detailsMentions,
  );
});
