// @vitest-environment jsdom
/**
 * ActionButton (#7) — the ONE canonical action button (the Tell-a-story look). Renders as a Next.js
 * <Link> (<a>) when given `href`, else a <button>. Now also the successor to the retired KindredButton:
 * primary/secondary/ghost variants, fullWidth, `label` content fallback, and name/value passthrough.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionButton } from "./ActionButton";
import styles from "./ActionButton.module.css";

afterEach(() => cleanup());

describe("ActionButton", () => {
  it("renders a link (<a href>) with the shared + primary class when given href", () => {
    render(<ActionButton href="/hub/tell">Tell a story</ActionButton>);
    const link = screen.getByRole("link", { name: "Tell a story" });
    expect(link.getAttribute("href")).toBe("/hub/tell");
    expect(link.className).toContain(styles.button);
    expect(link.className).toContain(styles.primary);
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

  it("defaults to the primary variant and applies variant classes", () => {
    const { rerender } = render(<ActionButton>Default</ActionButton>);
    expect(screen.getByRole("button").className).toContain(styles.primary);

    rerender(<ActionButton variant="secondary">Quiet</ActionButton>);
    const secondary = screen.getByRole("button");
    expect(secondary.className).toContain(styles.secondary);
    expect(secondary.className).not.toContain(styles.primary);

    rerender(<ActionButton variant="ghost">Text</ActionButton>);
    const ghost = screen.getByRole("button");
    expect(ghost.className).toContain(styles.ghost);
  });

  it("applies the fullWidth class only when requested", () => {
    const { rerender } = render(<ActionButton>Auto</ActionButton>);
    expect(screen.getByRole("button").className).not.toContain(styles.fullWidth);

    rerender(<ActionButton fullWidth>Wide</ActionButton>);
    expect(screen.getByRole("button").className).toContain(styles.fullWidth);
  });

  it("renders `label` as content when no children are given (KindredButton compat)", () => {
    render(<ActionButton label="Reseed" />);
    expect(screen.getByRole("button", { name: "Reseed" })).toBeTruthy();
  });

  it("forwards name/value/data-testid to the underlying <button>", () => {
    render(
      <ActionButton name="intent" value="send_email" data-testid="cta">
        Send
      </ActionButton>,
    );
    const button = screen.getByTestId("cta") as HTMLButtonElement;
    expect(button.name).toBe("intent");
    expect(button.value).toBe("send_email");
  });
});
