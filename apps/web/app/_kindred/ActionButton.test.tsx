// @vitest-environment jsdom
/**
 * ActionButton (#7) — the ONE canonical primary action button (the Tell-a-story look). Renders as a
 * Next.js <Link> (<a>) when given `href`, else a <button>. Used for Tell a story / Add Photos / Invite
 * so the primary CTA can't drift per surface.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionButton } from "./ActionButton";
import styles from "./ActionButton.module.css";

afterEach(() => cleanup());

describe("ActionButton", () => {
  it("renders a link (<a href>) with the shared class when given href", () => {
    render(<ActionButton href="/hub/tell">Tell a story</ActionButton>);
    const link = screen.getByRole("link", { name: "Tell a story" });
    expect(link.getAttribute("href")).toBe("/hub/tell");
    expect(link.className).toContain(styles.button);
  });

  it("renders a <button> and fires onClick when given no href", () => {
    const onClick = vi.fn();
    render(<ActionButton onClick={onClick}>Add Photos</ActionButton>);
    const button = screen.getByRole("button", { name: "Add Photos" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports a submit button and the disabled state", () => {
    render(
      <ActionButton type="submit" disabled>
        Send invite
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Send invite" });
    expect(button.getAttribute("type")).toBe("submit");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
