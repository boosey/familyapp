// @vitest-environment jsdom
/**
 * Companion regression for the tree's "predetermined parents" add (2026-07-14) + #285 checkboxes:
 * when a couple's seam "+" is clicked, the co-parent is the OTHER partner and must arrive
 * PRE-CHECKED in the co-parent checkbox list (not left on the first partner). Multi-partner:
 * any subset may be checked; none = this-parent-only.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { addRelativeAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
}));
vi.mock("../app/hub/tree/kin-actions", () => ({ addRelativeAction }));

import { AddRelativeForm } from "@/app/hub/tree/add-relative-form";

const OPTIONS = [
  { id: "partner-a", name: "Partner A" },
  { id: "partner-b", name: "Partner B" },
];

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
});

function checkedIds(): string[] {
  return OPTIONS.filter((p) => {
    const el = screen.getByTestId(`add-relative-coparent-${p.id}`) as HTMLInputElement;
    return el.checked;
  }).map((p) => p.id);
}

it("pre-checks the clicked couple's co-parent, not merely the first partner", () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
      preselectedCoParentId="partner-b"
    />,
  );
  expect(checkedIds()).toEqual(["partner-b"]);
});

it("checks none when no co-parent was predetermined (this-parent-only default)", () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
    />,
  );
  expect(checkedIds()).toEqual([]);
});

it("ignores a predetermined co-parent that isn't among the options (defensive)", () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
      preselectedCoParentId="ghost"
    />,
  );
  expect(checkedIds()).toEqual([]);
});

it("defaults parent/child nature to biological", () => {
  render(
    <AddRelativeForm familyId="fam-1" anchorPersonId="a" initialRelation="child" />,
  );
  const nature = screen.getByTestId("add-relative-nature") as HTMLSelectElement;
  expect(nature.value).toBe("biological");
});
