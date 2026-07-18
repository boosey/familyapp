// @vitest-environment jsdom
/**
 * InfoTooltip (#160) — a circled-i info affordance that reveals a sentence as an accessible tooltip.
 * Verifies: the trigger has an accessible name and the text is hidden until revealed; click reveals
 * and toggles; keyboard focus reveals; Escape and blur dismiss. Not hover-only (click/tap + focus).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InfoTooltip } from "./InfoTooltip";

afterEach(() => cleanup());

const LABEL = "Why you approve requests";
const TEXT = "As steward, you approve everyone who joins.";

describe("InfoTooltip", () => {
  it("names the trigger and hides the text until revealed", () => {
    render(<InfoTooltip label={LABEL} text={TEXT} />);
    expect(screen.getByRole("button", { name: LABEL })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("reveals and hides on click (works for tap/mouse), toggling aria-expanded", () => {
    render(<InfoTooltip label={LABEL} text={TEXT} />);
    const trigger = screen.getByRole("button", { name: LABEL });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(TEXT);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // The tooltip is wired to the trigger for assistive tech.
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);

    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reveals on keyboard focus (not hover-only) and dismisses on Escape", () => {
    render(<InfoTooltip label={LABEL} text={TEXT} />);
    const trigger = screen.getByRole("button", { name: LABEL });

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(TEXT);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dismisses on blur", () => {
    render(<InfoTooltip label={LABEL} text={TEXT} />);
    const trigger = screen.getByRole("button", { name: LABEL });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
