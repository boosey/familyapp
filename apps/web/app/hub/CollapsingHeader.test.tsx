// @vitest-environment jsdom
/**
 * ADR-0025 mobile Phase B, Increment 2 — <CollapsingHeader> swaps by viewport:
 *  - desktop (useIsCompact === false, the server + first-paint contract) → a plain `<header>` (no
 *    sticky/collapse classes — desktop is byte-for-byte unchanged);
 *  - phone (true) → the same `<header>` with the sticky class, gaining the hidden class when
 *    useScrollDirection reports hidden.
 * useIsCompact and useScrollDirection are mocked (mirroring hub-primary-nav.test.tsx) so we can drive
 * each branch and the hidden flag without a real viewport / scroll.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { vi } from "vitest";
import { CollapsingHeader } from "./CollapsingHeader";
import styles from "./page.module.css";

let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({
  useIsCompact: () => compact,
}));

let hidden = false;
vi.mock("./useScrollDirection", () => ({
  useScrollDirection: () => hidden,
}));

afterEach(() => {
  cleanup();
  compact = false;
  hidden = false;
});

const NAV = <nav data-testid="nav-child" />;

describe("CollapsingHeader viewport branch", () => {
  it("renders the family name as an h1 and its children in both branches", () => {
    compact = false;
    const { container, getByTestId, rerender } = render(
      <CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("The Marinos");
    expect(container.querySelector(`.${styles.brandMark}`)).not.toBeNull();
    expect(getByTestId("nav-child")).toBeTruthy();
    compact = true;
    rerender(<CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>);
    expect(container.querySelector("h1")?.textContent).toBe("The Marinos");
    expect(container.querySelector(`.${styles.brandMark}`)).not.toBeNull();
    expect(getByTestId("nav-child")).toBeTruthy();
  });

  it("renders a plain header on desktop (no sticky/collapse classes)", () => {
    compact = false;
    const { container } = render(<CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>);
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.className).not.toContain(styles.headerSticky);
    expect(header?.className).not.toContain(styles.headerHidden);
    // The title row is still present.
    expect(container.querySelector(`.${styles.titleRow}`)).not.toBeNull();
  });

  it("makes the header sticky on a phone", () => {
    compact = true;
    const { container } = render(<CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>);
    const header = container.querySelector("header");
    expect(header?.className).toContain(styles.headerSticky);
  });

  it("applies the hidden class only when useScrollDirection reports hidden (compact)", () => {
    compact = true;
    hidden = false;
    const { container, rerender } = render(
      <CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>,
    );
    expect(container.querySelector("header")?.className).not.toContain(styles.headerHidden);
    hidden = true;
    rerender(<CollapsingHeader familyName="The Marinos">{NAV}</CollapsingHeader>);
    expect(container.querySelector("header")?.className).toContain(styles.headerHidden);
  });
});
