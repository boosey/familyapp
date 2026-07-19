// @vitest-environment jsdom
/**
 * HubSubNav (#189) — the shared sub-tab pill row. It single-sources the pill look (lifted from
 * Family's `.subLink`/`.badge` in HubTabs.module.css) so Stories/Album/Family/Questions render their
 * pills the same way instead of each re-implementing the mapping + active state + badge.
 *
 * A pill is either a link (`href`, renders <a> — Family) or a button (`onClick`, renders <button> —
 * Questions). Exactly one item may be active (`aria-current="page"`), and any item may carry a numeric
 * badge (hidden at 0/undefined).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HubSubNav } from "./HubSubNav";
import hubTabStyles from "./HubTabs.module.css";

afterEach(() => cleanup());

describe("HubSubNav", () => {
  it("renders link items as <a href> using the shared pill class", () => {
    render(
      <HubSubNav
        ariaLabel="Test nav"
        items={[
          { key: "a", label: "Alpha", href: "/x?a" },
          { key: "b", label: "Beta", href: "/x?b" },
        ]}
        active="a"
      />,
    );
    const alpha = screen.getByText("Alpha").closest("a")!;
    expect(alpha.getAttribute("href")).toBe("/x?a");
    expect(alpha.className).toContain(hubTabStyles.subLink);
    expect(alpha.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Beta").closest("a")!.getAttribute("aria-current")).toBeNull();
  });

  it("renders button items and fires onSelect with the key", () => {
    const onSelect = vi.fn();
    render(
      <HubSubNav
        ariaLabel="Test nav"
        items={[
          { key: "a", label: "Alpha" },
          { key: "b", label: "Beta" },
        ]}
        active="a"
        onSelect={onSelect}
      />,
    );
    const beta = screen.getByText("Beta").closest("button")!;
    expect(beta.className).toContain(hubTabStyles.subLink);
    fireEvent.click(beta);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("badges an item with its count and an accessible label; hides at 0/undefined", () => {
    render(
      <HubSubNav
        ariaLabel="Test nav"
        items={[
          { key: "a", label: "Alpha", href: "/x", badge: 4, badgeLabel: "4 pending" },
          { key: "b", label: "Beta", href: "/y", badge: 0 },
        ]}
        active="a"
      />,
    );
    const badge = screen.getByLabelText("4 pending");
    expect(badge.textContent).toBe("4");
    expect(badge.className).toContain(hubTabStyles.badge);
    // Beta has badge 0 → no badge element at all.
    expect(screen.getByText("Beta").closest("a")!.querySelector(`.${hubTabStyles.badge}`)).toBeNull();
  });

  it("labels the nav region for assistive tech", () => {
    render(
      <HubSubNav ariaLabel="Family surface" items={[{ key: "a", label: "A", href: "/x" }]} active="a" />,
    );
    expect(screen.getByRole("navigation", { name: "Family surface" })).toBeTruthy();
  });
});
