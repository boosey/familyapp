// @vitest-environment jsdom
/**
 * Behavior test for <FamilyDesignatorChips> — the action-flow single-select family designator
 * (ADR-0021, #49), now the shared chips that replaced the old `<select>`.
 *
 * Contract:
 *  - It renders one aria-pressed chip per family and posts the chosen id via a hidden `required` input
 *    (the `name` the server action reads), so the native form submit carries the selection.
 *  - Seeded family → that chip is ON and the hidden input carries it (no ambiguity).
 *  - Null seed with >1 family → NO chip is pre-selected and the hidden input is empty + required, so an
 *    empty submit is blocked (the browser can't silently pick an arbitrary family).
 *  - A single family auto-resolves to its lone id even with a null seed (unambiguous).
 *  - Picking a chip updates the posted value and, being router-free, never navigates.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FamilyDesignatorChips } from "@/app/hub/FamilyDesignatorChips";

afterEach(cleanup);

const FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
  { id: "fam-c", name: "Rossi" },
];

const baseProps = {
  name: "familyId",
  label: "Family",
  requiredMessage: "Choose a family.",
};

/** The hidden input that carries the chosen family id into the native form submit. */
const hiddenInput = (container: HTMLElement): HTMLInputElement =>
  container.querySelector('input[name="familyId"]') as HTMLInputElement;
const pressed = (name: string): boolean =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";

describe("FamilyDesignatorChips — seed from filter", () => {
  it("marks the seeded family ON and carries it in the hidden required input", () => {
    const { container } = render(
      <FamilyDesignatorChips families={FAMILIES} seeded="fam-b" {...baseProps} />,
    );
    expect(pressed("Marino")).toBe(true);
    expect(pressed("Esposito")).toBe(false);
    const input = hiddenInput(container);
    expect(input.value).toBe("fam-b");
    expect(input.required).toBe(true);
  });

  it("pre-selects NOTHING (empty required input) with a null seed and >1 family", () => {
    const { container } = render(
      <FamilyDesignatorChips families={FAMILIES} seeded={null} {...baseProps} />,
    );
    for (const f of FAMILIES) expect(pressed(f.name)).toBe(false);
    const input = hiddenInput(container);
    expect(input.value).toBe("");
    expect(input.required).toBe(true);
  });

  it("auto-resolves the lone family (chip ON, id posted) for a single-family viewer with a null seed", () => {
    const { container } = render(
      <FamilyDesignatorChips families={[FAMILIES[0]!]} seeded={null} {...baseProps} />,
    );
    expect(pressed("Esposito")).toBe(true);
    expect(hiddenInput(container).value).toBe("fam-a");
  });

  it("prefers the steward short name on the chip", () => {
    render(
      <FamilyDesignatorChips
        families={[{ id: "fam-a", name: "The Esposito family", shortName: "Esposito" }]}
        seeded="fam-a"
        {...baseProps}
      />,
    );
    expect(screen.getByRole("button", { name: "Esposito" })).toBeTruthy();
    expect(screen.queryByText("The Esposito family")).toBeNull();
  });
});

describe("FamilyDesignatorChips — single-select, no write-back", () => {
  it("updates the posted id when a different chip is picked", () => {
    const { container } = render(
      <FamilyDesignatorChips families={FAMILIES} seeded="fam-a" {...baseProps} />,
    );
    expect(hiddenInput(container).value).toBe("fam-a");
    fireEvent.click(screen.getByRole("button", { name: "Rossi" }));
    expect(hiddenInput(container).value).toBe("fam-c");
    // Single-select: exactly one chip stays ON.
    expect(pressed("Rossi")).toBe(true);
    expect(pressed("Esposito")).toBe(false);
  });
});
