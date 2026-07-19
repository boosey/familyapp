// @vitest-environment jsdom
/**
 * SegmentedControl (#1/#5) — the ONE boxed pill selector for the whole hub: sub-tab navs AND the
 * radiogroup view/mode selectors all route through it so they can't drift into three different pill
 * looks (the `.subLink` vs `.modePill` vs AlbumViewControls-inline drift). One boxed group, a raised
 * selected pill.
 *
 * Rendering modes, chosen by whether items carry `href`:
 *   - LINK mode (every item has href): <nav> of <a>, active = aria-current="page" (sub-navs).
 *   - BUTTON mode (no href): <button>s + `variant` a11y — tabs (aria-selected), radio (aria-checked +
 *     arrow keys + roving tabindex), toggle (aria-pressed). Clicks fire onSelect(key).
 * Any item may carry a numeric badge (hidden at 0/undefined). Every pill wears the shared `.pill` class
 * inside the shared `.group` box, so the look is single-sourced.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";
import styles from "./SegmentedControl.module.css";

afterEach(() => cleanup());

describe("SegmentedControl — link mode", () => {
  it("renders link items as <a href> with the active one marked aria-current", () => {
    render(
      <SegmentedControl
        ariaLabel="Family surface"
        active="tree"
        items={[
          { key: "tree", label: "Family tree", href: "/hub?tab=family&view=tree" },
          { key: "list", label: "List", href: "/hub?tab=family&view=list" },
        ]}
      />,
    );
    const tree = screen.getByText("Family tree").closest("a")!;
    expect(tree.getAttribute("href")).toBe("/hub?tab=family&view=tree");
    expect(tree.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("List").closest("a")!.getAttribute("aria-current")).toBeNull();
  });

  it("wraps link items in a labelled <nav> using the shared boxed group + pill classes", () => {
    render(
      <SegmentedControl
        ariaLabel="Family surface"
        active="tree"
        items={[{ key: "tree", label: "Family tree", href: "/x" }]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Family surface" });
    expect(nav.className).toContain(styles.group);
    expect(screen.getByText("Family tree").closest("a")!.className).toContain(styles.pill);
  });
});

describe("SegmentedControl — button mode", () => {
  it("tabs variant: role=tab, active aria-selected, fires onSelect with the key on click", () => {
    const onSelect = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Browse mode"
        active="feed"
        variant="tabs"
        onSelect={onSelect}
        items={[
          { key: "feed", label: "Feed" },
          { key: "timeline", label: "Timeline" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Browse mode" })).toBeTruthy();
    const feed = screen.getByRole("tab", { name: "Feed" });
    expect(feed.getAttribute("aria-selected")).toBe("true");
    const timeline = screen.getByRole("tab", { name: "Timeline" });
    expect(timeline.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(timeline);
    expect(onSelect).toHaveBeenCalledWith("timeline");
  });

  it("radio variant: role=radio, active aria-checked + is the sole tab stop (roving tabindex)", () => {
    render(
      <SegmentedControl
        ariaLabel="Album view"
        active="masonry"
        variant="radio"
        onSelect={vi.fn()}
        items={[
          { key: "masonry", label: "Masonry" },
          { key: "grid", label: "Grid" },
          { key: "list", label: "List" },
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Album view" })).toBeTruthy();
    const masonry = screen.getByRole("radio", { name: "Masonry" });
    const grid = screen.getByRole("radio", { name: "Grid" });
    expect(masonry.getAttribute("aria-checked")).toBe("true");
    expect(masonry.getAttribute("tabindex")).toBe("0");
    expect(grid.getAttribute("aria-checked")).toBe("false");
    expect(grid.getAttribute("tabindex")).toBe("-1");
  });

  it("radio variant: ArrowRight selects the next option (wrapping)", () => {
    const onSelect = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Album view"
        active="list"
        variant="radio"
        onSelect={onSelect}
        items={[
          { key: "masonry", label: "Masonry" },
          { key: "grid", label: "Grid" },
          { key: "list", label: "List" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "List" }), { key: "ArrowRight" });
    // list is last → wraps to the first (masonry).
    expect(onSelect).toHaveBeenCalledWith("masonry");
  });

  it("toggle variant: active option carries aria-pressed=true", () => {
    render(
      <SegmentedControl
        ariaLabel="Timeline scope"
        active="whole"
        variant="toggle"
        onSelect={vi.fn()}
        items={[
          { key: "whole", label: "Whole family" },
          { key: "narrator", label: "Just me" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Whole family" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Just me" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("SegmentedControl — badges", () => {
  it("badges an item with its count + accessible label, and hides the badge at 0", () => {
    render(
      <SegmentedControl
        ariaLabel="Family surface"
        active="tree"
        items={[
          { key: "tree", label: "Family tree", href: "/x" },
          { key: "requests", label: "Requests", href: "/y", badge: 3, badgeLabel: "3 pending" },
          { key: "list", label: "List", href: "/z", badge: 0 },
        ]}
      />,
    );
    const badge = screen.getByLabelText("3 pending");
    expect(badge.textContent).toBe("3");
    // A 0/undefined badge renders no badge element on that pill.
    expect(screen.getByText("List").closest("a")!.textContent).toBe("List");
  });
});
