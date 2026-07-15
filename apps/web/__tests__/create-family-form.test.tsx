// @vitest-environment jsdom
/**
 * CreateFamilyForm — short-name auto-suggest wiring (ADR-0021 "Short name (Family)"):
 *  1. Typing into the family-name field live-fills the short-name field with the suggestion.
 *  2. Once the user edits the short-name field, further name typing no longer overrides it (dirty flag).
 *  3. Short name is optional — the form submits without it; the submit button enables on non-empty name.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateFamilyForm } from "@/app/families/new/CreateFamilyForm";

afterEach(cleanup);

function nameInput() {
  return screen.getByRole("textbox", { name: /family name/i }) as HTMLInputElement;
}
function shortNameInput() {
  return screen.getByRole("textbox", { name: /short name/i }) as HTMLInputElement;
}
function submitButton() {
  return screen.getByRole("button", { name: /create family/i }) as HTMLButtonElement;
}

it("live-fills the short-name field with the suggestion as the name is typed", () => {
  render(<CreateFamilyForm action={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "The Boudreaux family" } });
  expect(shortNameInput().value).toBe("Boudreaux");
});

it("stops overriding the short-name field once the user edits it (dirty flag holds)", () => {
  render(<CreateFamilyForm action={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "The Boudreaux family" } });
  expect(shortNameInput().value).toBe("Boudreaux");

  // User edits the short name.
  fireEvent.change(shortNameInput(), { target: { value: "The Cajun crew" } });
  expect(shortNameInput().value).toBe("The Cajun crew");

  // Typing more in the name field must NOT clobber the user's edit.
  fireEvent.change(nameInput(), { target: { value: "The Esposito family" } });
  expect(shortNameInput().value).toBe("The Cajun crew");
});

it("short name is optional — submit enables on a non-empty name alone", () => {
  render(<CreateFamilyForm action={vi.fn()} />);
  expect(submitButton().disabled).toBe(true);

  fireEvent.change(nameInput(), { target: { value: "Esposito" } });
  expect(submitButton().disabled).toBe(false);
  // Short name may stay whatever the suggestion produced (or be cleared) and the form is still submittable.
  fireEvent.change(shortNameInput(), { target: { value: "" } });
  expect(submitButton().disabled).toBe(false);
});
