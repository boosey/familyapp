// @vitest-environment jsdom
/**
 * Companion regression for the tree's "predetermined parents" add (2026-07-14): when a couple's seam
 * "+" is clicked, the co-parent is the OTHER partner and must arrive PRE-SELECTED in the "Other parent"
 * picker (not left on the first partner). This is what makes the click's POSITION bind both parents,
 * and what makes it correct once a person has more than one partner. The server action is mocked so
 * this stays a pure client-form test.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { addRelativeAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
}));
vi.mock("../app/hub/kin/actions", () => ({ addRelativeAction }));

import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";

const OPTIONS = [
  { id: "partner-a", name: "Partner A" },
  { id: "partner-b", name: "Partner B" },
];

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
});

function coParentSelect(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector('select[name="coParentPersonId"]');
  expect(el).toBeTruthy();
  return el as HTMLSelectElement;
}

it("pre-selects the clicked couple's co-parent, not merely the first partner", () => {
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
      preselectedCoParentId="partner-b"
    />,
  );
  expect(coParentSelect(container).value).toBe("partner-b");
});

it("falls back to the first partner when no co-parent was predetermined", () => {
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
    />,
  );
  expect(coParentSelect(container).value).toBe("partner-a");
});

it("ignores a predetermined co-parent that isn't among the options (defensive)", () => {
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="partner-a"
      initialRelation="child"
      coParentOptions={OPTIONS}
      preselectedCoParentId="ghost"
    />,
  );
  expect(coParentSelect(container).value).toBe("partner-a");
});
