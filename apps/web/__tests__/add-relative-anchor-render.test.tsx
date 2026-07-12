// @vitest-environment jsdom
/**
 * Render test for the add-relative form's TARGETED-ADD affordances (issue #32): when launched from a
 * person panel with an `anchorPersonId` (+ optional `initialRelation`), the form must (1) carry the
 * anchor as a hidden field so core anchors the new relative on that person, and (2) preselect the
 * relation `<select>`. Without an anchor, no hidden anchor field is emitted. The server action is
 * mocked so this stays a pure client-form test.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { addRelativeAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
}));
vi.mock("../app/hub/kin/actions", () => ({ addRelativeAction }));

import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
});

it("renders a hidden anchor input and preselects the relation when targeted", () => {
  const { container } = render(
    <AddRelativeForm familyId="fam-1" anchorPersonId="p-xyz" initialRelation="child" />,
  );

  const anchor = container.querySelector('input[type="hidden"][name="anchorPersonId"]');
  expect(anchor).toBeTruthy();
  expect(anchor!.getAttribute("value")).toBe("p-xyz");

  const relation = container.querySelector('select[name="relation"]') as HTMLSelectElement;
  expect(relation).toBeTruthy();
  expect(relation.value).toBe("child");
});

it("omits the hidden anchor input when no anchor is supplied", () => {
  const { container } = render(<AddRelativeForm familyId="fam-1" />);

  expect(container.querySelector('input[name="anchorPersonId"]')).toBeNull();

  // The relation select falls back to its default when no initialRelation is given.
  const relation = container.querySelector('select[name="relation"]') as HTMLSelectElement;
  expect(relation.value).toBe("parent");
});
