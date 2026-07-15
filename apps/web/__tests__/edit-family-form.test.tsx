// @vitest-environment jsdom
/**
 * EditFamilyForm (steward-only Edit-a-Family, #54) — seeded-value + short-name dirty-flag wiring:
 *  1. Renders the family's existing values; a family WITH a short name is pre-seeded dirty so editing
 *     the name never clobbers the short name.
 *  2. A family with NO short name pre-fills the heuristic suggestion and keeps live-suggesting on name
 *     edits until the user edits the short name (dirty flag holds).
 *  3. Submit button disables on an empty name.
 *  4. A hidden familyId field carries the id for the server action's stewardship re-check.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditFamilyForm } from "@/app/families/[id]/edit/EditFamilyForm";

afterEach(cleanup);

function nameInput() {
  return screen.getByRole("textbox", { name: /family name/i }) as HTMLInputElement;
}
function shortNameInput() {
  return screen.getByRole("textbox", { name: /short name/i }) as HTMLInputElement;
}
function submitButton() {
  return screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
}

it("renders seeded values; editing the name does not change an existing short name", () => {
  render(
    <EditFamilyForm
      action={vi.fn()}
      familyId="fam-1"
      initialName="The Boudreaux family"
      initialShortName="Boudreaux"
      initialDescription="Cajuns of Lafayette"
      initialDiscoverable={true}
    />,
  );
  expect(nameInput().value).toBe("The Boudreaux family");
  expect(shortNameInput().value).toBe("Boudreaux");

  // Pre-seeded dirty (a short name already exists), so editing the name must NOT re-suggest.
  fireEvent.change(nameInput(), { target: { value: "The Esposito family" } });
  expect(shortNameInput().value).toBe("Boudreaux");
});

it("an existing family with no short name starts empty and live-suggests only on a name edit", () => {
  render(
    <EditFamilyForm
      action={vi.fn()}
      familyId="fam-2"
      initialName="The Esposito family"
      initialShortName=""
      initialDescription=""
      initialDiscoverable={false}
    />,
  );
  // Empty on mount — no short name is seeded (so an unrelated save never persists a guess).
  expect(shortNameInput().value).toBe("");

  // Editing the formal name live-suggests into the still-clean field.
  fireEvent.change(nameInput(), { target: { value: "The Marino family" } });
  expect(shortNameInput().value).toBe("Marino");

  // Once the user edits the short name, it holds against further name edits.
  fireEvent.change(shortNameInput(), { target: { value: "The Cajun crew" } });
  fireEvent.change(nameInput(), { target: { value: "The Landry family" } });
  expect(shortNameInput().value).toBe("The Cajun crew");
});

it("leaves the short name empty when the steward touches neither field (no silent guess persisted)", () => {
  render(
    <EditFamilyForm
      action={vi.fn()}
      familyId="fam-2b"
      initialName="The Esposito family"
      initialShortName=""
      initialDescription=""
      initialDiscoverable={false}
    />,
  );
  // Steward opens the page to change something unrelated and never touches name/short-name:
  // the short-name field must stay empty so the save can't persist a heuristic guess.
  expect(shortNameInput().value).toBe("");
});

it("disables submit when the name is cleared, enables it with a non-empty name", () => {
  render(
    <EditFamilyForm
      action={vi.fn()}
      familyId="fam-3"
      initialName="Esposito"
      initialShortName="Esposito"
      initialDescription=""
      initialDiscoverable={false}
    />,
  );
  expect(submitButton().disabled).toBe(false);
  fireEvent.change(nameInput(), { target: { value: "   " } });
  expect(submitButton().disabled).toBe(true);
  fireEvent.change(nameInput(), { target: { value: "Renamed" } });
  expect(submitButton().disabled).toBe(false);
});

it("carries the family id in a hidden familyId field", () => {
  const { container } = render(
    <EditFamilyForm
      action={vi.fn()}
      familyId="fam-42"
      initialName="Esposito"
      initialShortName=""
      initialDescription=""
      initialDiscoverable={false}
    />,
  );
  const hidden = container.querySelector('input[name="familyId"]') as HTMLInputElement;
  expect(hidden).not.toBeNull();
  expect(hidden.value).toBe("fam-42");
});
