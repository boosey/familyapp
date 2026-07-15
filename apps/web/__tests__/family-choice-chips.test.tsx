// @vitest-environment jsdom
/**
 * Render test for the shared <FamilyChoiceChips> — the action-flow audience / placement picker that
 * replaced the pre-ADR two-checkbox <FamilyPicker>. One aria-pressed toggle chip per family, driven by
 * the parent-owned `selected` set; renders the steward-set short name in place of the formal name when
 * present; toggling calls `onToggle` with the chip's id.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { FamilyChoiceChips } from "@/app/hub/FamilyChoiceChips";

afterEach(cleanup);

it("renders one pressed/unpressed chip per family from the selected set", () => {
  render(
    <FamilyChoiceChips
      families={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
      selected={new Set(["a"])}
      onToggle={() => {}}
    />,
  );
  const chips = screen.getAllByRole("button");
  expect(chips).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Beta" }).getAttribute("aria-pressed")).toBe("false");
});

it("prefers the steward short name over the formal name", () => {
  render(
    <FamilyChoiceChips
      families={[{ id: "a", name: "The Boudreaux family", shortName: "Boudreaux" }]}
      selected={new Set()}
      onToggle={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Boudreaux" })).toBeTruthy();
  expect(screen.queryByText("The Boudreaux family")).toBeNull();
});

it("falls back to the formal name when no short name is set", () => {
  render(
    <FamilyChoiceChips
      families={[{ id: "a", name: "Alpha", shortName: null }]}
      selected={new Set()}
      onToggle={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
});

it("calls onToggle with the family id when a chip is clicked", () => {
  const onToggle = vi.fn();
  render(
    <FamilyChoiceChips
      families={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
      selected={new Set(["a"])}
      onToggle={onToggle}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Beta" }));
  expect(onToggle).toHaveBeenCalledWith("b");
});

it("omits the group role when unlabelled and adds it when an ariaLabel is given", () => {
  const { rerender } = render(
    <FamilyChoiceChips
      families={[{ id: "a", name: "Alpha" }]}
      selected={new Set()}
      onToggle={() => {}}
    />,
  );
  // No ariaLabel → no bare/unlabelled group role (the chips usually sit in a labelled <fieldset>).
  expect(screen.queryByRole("group")).toBeNull();

  rerender(
    <FamilyChoiceChips
      families={[{ id: "a", name: "Alpha" }]}
      selected={new Set()}
      onToggle={() => {}}
      ariaLabel="Share with families"
    />,
  );
  expect(screen.getByRole("group", { name: "Share with families" })).toBeTruthy();
});

it("disables every chip when disabled", () => {
  render(
    <FamilyChoiceChips
      families={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
      selected={new Set(["a"])}
      onToggle={() => {}}
      disabled
    />,
  );
  for (const chip of screen.getAllByRole("button")) {
    expect((chip as HTMLButtonElement).disabled).toBe(true);
  }
});
