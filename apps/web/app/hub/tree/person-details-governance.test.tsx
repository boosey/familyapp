// @vitest-environment jsdom
/**
 * PersonDetails sheet chrome — flat token module (#223) + hub ActionButton-styled icon row.
 * Edge governance (#254/#265) lives on the line-governance menu, not this sheet.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import sheetStyles from "./PersonDetails.module.css";
import { PersonDetails } from "./person-details";
import type { PersonEditabilityResult, SavePersonEditResult } from "./actions";

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));
const sheetCss = readFileSync(join(here, "PersonDetails.module.css"), "utf8");

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
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
  };
}

const editableNo = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: false });
const editableYes = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: true });
const saveOk = async (): Promise<SavePersonEditResult> => ({ ok: true });

describe("PersonDetails sheet chrome — flat token module (#223)", () => {
  it("mounts the sheet on the hashed module class (no Phase-1 inline chrome)", async () => {
    render(
      <PersonDetails
        node={node({ personId: "bob", displayName: "Bob" })}
        relationToViewer={null}
        familyId="F"
        onClose={() => {}}
        checkEditable={editableNo}
        saveEdit={saveOk}
      />,
    );
    const sheet = await screen.findByTestId("tree-person-details");
    expect(sheet.className).toContain(sheetStyles.sheet);
  });

  it("PersonDetails.module.css keeps a flat sheet and ActionButton-styled icon actions", () => {
    expect(sheetCss).toContain("var(--surface-card)");
    expect(sheetCss).toContain("var(--border)");
    expect(sheetCss).toContain("var(--radius-lg)");
    expect(sheetCss).toContain("box-shadow: none");
    expect(sheetCss).toContain("var(--tell-card-bg)");
    expect(sheetCss).toContain("var(--shadow-card)");
    // Contract tokens only — the old inline --shadow-lg was not in the skin contract.
    expect(sheetCss).not.toContain("--shadow-lg");
    expect(sheetCss).not.toContain("var(--tape-bg)");
    expect(sheetCss).not.toMatch(/--tilt/);
    expect(sheetCss).not.toContain("var(--highlighter)");
    expect(sheetCss).not.toContain("var(--sticker-");
  });

  it("does not render the Relationships-in-this-family section", async () => {
    render(
      <PersonDetails
        node={node({ personId: "bob", displayName: "Bob" })}
        relationToViewer={null}
        familyId="F"
        onClose={() => {}}
        checkEditable={editableNo}
        saveEdit={saveOk}
      />,
    );
    await screen.findByTestId("tree-person-details");
    expect(screen.queryByTestId("tree-details-gov-edges")).toBeNull();
  });

  it("puts Edit + Stories/Photos/Mentions icon actions in one row when editable", async () => {
    render(
      <PersonDetails
        node={node({ personId: "bob", displayName: "Bob" })}
        relationToViewer={null}
        familyId="F"
        onClose={() => {}}
        checkEditable={editableYes}
        saveEdit={saveOk}
      />,
    );
    const row = await screen.findByTestId("tree-details-actions");
    expect(row.className).toContain(sheetStyles.actions);
    // The Edit button mounts a render tick after its container once the async editability probe
    // resolves — await the child before the synchronous getBy assertions so this doesn't flake
    // under parallel CI load (#353).
    await screen.findByTestId("tree-details-edit");
    expect(row.contains(screen.getByTestId("tree-details-edit"))).toBe(true);
    expect(row.contains(screen.getByTestId("tree-details-stories"))).toBe(true);
    expect(row.contains(screen.getByTestId("tree-details-photos"))).toBe(true);
    expect(row.contains(screen.getByTestId("tree-details-mentions"))).toBe(true);
    expect(screen.getByTestId("tree-details-edit").className).toContain(sheetStyles.iconAction);
    expect(screen.getByTestId("tree-details-stories").getAttribute("aria-label")).toBe(
      hub.tree.detailsStories,
    );
  });
});
