// @vitest-environment jsdom
/**
 * Render test for the shared <FamilyPicker> — one checkbox per family, posting under the given `name`,
 * with the parent-owned `selected` set driving the checked state (Task 4 multi-family share picker).
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FamilyPicker } from "@/app/hub/FamilyPicker";

afterEach(cleanup);

it("renders a checkbox per family and posts under the given name", () => {
  const { container } = render(
    <FamilyPicker
      families={[
        { familyId: "a", familyName: "Alpha" },
        { familyId: "b", familyName: "Beta" },
      ]}
      selected={new Set(["a"])}
      onToggle={() => {}}
      name="familyIds"
    />,
  );
  const boxes = container.querySelectorAll('input[type="checkbox"][name="familyIds"]');
  expect(boxes.length).toBe(2);
  expect((boxes[0] as HTMLInputElement).checked).toBe(true);
  expect((boxes[1] as HTMLInputElement).checked).toBe(false);
});
