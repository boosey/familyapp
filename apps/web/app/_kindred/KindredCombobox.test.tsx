// @vitest-environment jsdom
/**
 * KindredCombobox (#204) — the reusable single-select type-ahead used by the Ask panel's person
 * selector. Pins the core behaviour the issue calls out:
 *  1. Filter-as-you-type: typing narrows the listbox (case-insensitive substring).
 *  2. Selection rides the form as a hidden input carrying the option's id; editing the text after
 *     choosing CLEARS the hidden input (never a stale id).
 *  3. The ADR-0006 pending marker: an option's `note` ("(invited)") renders next to its name.
 *  4. Keyboard: ArrowDown/ArrowUp move the active option, Enter chooses it, Escape reverts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KindredCombobox } from "./KindredCombobox";

const OPTIONS = [
  { id: "p-sofia", name: "Sofia Boudreaux" },
  { id: "p-marco", name: "Marco Marino" },
  { id: "p-june", name: "June Thibodeaux", note: "(invited)" },
];

function renderCombobox() {
  return render(
    <KindredCombobox
      options={OPTIONS}
      name="targetPersonId"
      ariaLabel="For"
      placeholder="Type a name…"
      noMatchesText="No one by that name."
      invalidText="Choose someone from the list."
      required
    />,
  );
}

function combobox(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "For" }) as HTMLInputElement;
}

function hiddenId(): string | null {
  const el = document.querySelector<HTMLInputElement>(
    'input[type="hidden"][name="targetPersonId"]',
  );
  return el ? el.value : null;
}

afterEach(cleanup);

describe("KindredCombobox — filtering", () => {
  it("lists every option on focus and narrows as you type", () => {
    renderCombobox();
    fireEvent.focus(combobox());
    expect(screen.getAllByRole("option")).toHaveLength(3);

    fireEvent.change(combobox(), { target: { value: "bo" } });
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Sofia Boudreaux", "June Thibodeaux (invited)"]);
  });

  it("shows the no-matches text when nothing fits", () => {
    renderCombobox();
    fireEvent.focus(combobox());
    fireEvent.change(combobox(), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No one by that name.")).toBeTruthy();
  });

  it("renders the pending invitee note next to the name (ADR-0006)", () => {
    renderCombobox();
    fireEvent.focus(combobox());
    const june = screen.getByRole("option", { name: /June Thibodeaux/ });
    expect(june.textContent).toContain("(invited)");
  });
});

describe("KindredCombobox — selection", () => {
  it("clicking an option fills the input and emits the hidden id", () => {
    renderCombobox();
    fireEvent.focus(combobox());
    fireEvent.mouseDown(screen.getByRole("option", { name: /Sofia/ }));
    expect(combobox().value).toBe("Sofia Boudreaux");
    expect(hiddenId()).toBe("p-sofia");
  });

  it("editing the text after choosing clears the hidden id", () => {
    renderCombobox();
    fireEvent.focus(combobox());
    fireEvent.mouseDown(screen.getByRole("option", { name: /Sofia/ }));
    expect(hiddenId()).toBe("p-sofia");

    fireEvent.change(combobox(), { target: { value: "Sofia B" } });
    expect(hiddenId()).toBeNull();
  });

  it("selects with the keyboard: ArrowDown + Enter", () => {
    renderCombobox();
    const input = combobox();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Marco Marino");
    expect(hiddenId()).toBe("p-marco");
  });

  it("Escape closes the popup and reverts the text to the chosen name", () => {
    renderCombobox();
    const input = combobox();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /Sofia/ }));

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "someone else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("Sofia Boudreaux");
    expect(hiddenId()).toBe("p-sofia");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("KindredCombobox — client-side validation", () => {
  it("blocks the form while the text names no valid option, clears once one is chosen", () => {
    renderCombobox();
    const input = combobox();

    // Empty field: native `required` catches this, but the custom error rides along too.
    expect(input.checkValidity()).toBe(false);

    // A typed name that matches nothing would pass native `required` — the custom-validity
    // error is what stops it submitting with NO hidden id (createAsk would throw server-side).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "someone else" } });
    expect(input.validity.customError).toBe(true);
    expect(input.validationMessage).toBe("Choose someone from the list.");
    expect(input.checkValidity()).toBe(false);
    expect(hiddenId()).toBeNull();

    // Choosing a real option clears the error and lets the form submit (clearing the text first
    // so the full list re-opens).
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Sofia/ }));
    expect(input.checkValidity()).toBe(true);
    expect(hiddenId()).toBe("p-sofia");
  });

  it("re-blocks when the chosen name is edited away", () => {
    renderCombobox();
    const input = combobox();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /Sofia/ }));
    expect(input.checkValidity()).toBe(true);

    fireEvent.change(input, { target: { value: "Sofia B" } });
    expect(input.checkValidity()).toBe(false);
    expect(hiddenId()).toBeNull();
  });
});
