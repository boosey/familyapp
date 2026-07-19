// @vitest-environment jsdom
/**
 * HubToolbar (#189) — the shared two-row control block every hub sub-tab (Stories, Album, Family,
 * Questions) composes so their toolbars can't drift. Four named slots:
 *
 *   R1:  [row1Left]  ·······  [row1Right]
 *   R2:  [row2Left]  ·······  [row2Right]
 *
 * The load-bearing rule proved here: a row whose BOTH slots are empty/nullish must NOT render — no
 * empty element, no reserved vertical space. This is what preserves Family's "List view + <2 families →
 * no selector row, content flush below" behaviour once expressed through the toolbar.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HubToolbar } from "./HubToolbar";
import styles from "./HubToolbar.module.css";

afterEach(() => cleanup());

describe("HubToolbar", () => {
  it("renders all four slots into their two rows", () => {
    render(
      <HubToolbar
        row1Left={<span data-testid="r1l">r1l</span>}
        row1Right={<span data-testid="r1r">r1r</span>}
        row2Left={<span data-testid="r2l">r2l</span>}
        row2Right={<span data-testid="r2r">r2r</span>}
      />,
    );
    expect(screen.getByTestId("r1l")).toBeTruthy();
    expect(screen.getByTestId("r1r")).toBeTruthy();
    expect(screen.getByTestId("r2l")).toBeTruthy();
    expect(screen.getByTestId("r2r")).toBeTruthy();
  });

  it("does NOT render a row whose both slots are empty (no element, no reserved space)", () => {
    const { container } = render(
      <HubToolbar row1Left={<span data-testid="r1l">r1l</span>} row1Right={<span>a</span>} />,
    );
    // Exactly ONE row rendered (R1). R2 is fully absent from the DOM — not an empty div.
    expect(container.querySelectorAll(`.${styles.row}`).length).toBe(1);
    expect(screen.getByTestId("r1l")).toBeTruthy();
  });

  it("renders a row when only ONE of its two slots is present", () => {
    const { container } = render(<HubToolbar row2Left={<span data-testid="r2l">r2l</span>} />);
    // R1 absent (both empty), R2 present (one slot filled).
    expect(container.querySelectorAll(`.${styles.row}`).length).toBe(1);
    expect(screen.getByTestId("r2l")).toBeTruthy();
  });

  it("renders NOTHING when every slot is empty", () => {
    const { container } = render(<HubToolbar />);
    expect(container.querySelectorAll(`.${styles.row}`).length).toBe(0);
    expect(container.firstChild).toBeNull();
  });

  it("treats null/undefined/false slots as empty (falsy is not content)", () => {
    const { container } = render(
      <HubToolbar row1Left={null} row1Right={undefined} row2Left={false} row2Right={null} />,
    );
    expect(container.querySelectorAll(`.${styles.row}`).length).toBe(0);
  });

  it("places the right slot in a right-justified wrapper", () => {
    render(<HubToolbar row1Left={<span>l</span>} row1Right={<span data-testid="r1r">r</span>} />);
    const right = screen.getByTestId("r1r").parentElement!;
    expect(right.className).toContain(styles.right);
  });
});
