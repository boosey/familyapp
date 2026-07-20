// @vitest-environment jsdom
/**
 * ADR-0025 mobile Phase B, Increment 1 — <BottomTabBar> renders the four primary tabs as an
 * icon+label bottom bar with parity to <HubTabs>: same keys, same labels, same numeric badges, same
 * active flag, same `onChange(key)` contract. (The routing that wraps `onChange` is exercised in
 * hub-primary-nav.test.tsx, mirroring the presentational-component / routing-wrapper split.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BottomTabBar } from "./BottomTabBar";
import { hub } from "@/app/_copy";

afterEach(cleanup);

const primary = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  { key: "questions", label: hub.shell.tabQuestions },
];

describe("BottomTabBar", () => {
  it("renders all four primary tab keys with their labels", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    for (const t of primary) {
      expect(screen.getByRole("tab", { name: new RegExp(t.label) })).toBeTruthy();
    }
  });

  it("carries the bottom-nav accessible landmark name", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: hub.shell.bottomNavAria }).tagName).toBe("NAV");
  });

  it("flags the active tab with aria-selected", () => {
    render(<BottomTabBar primaryTabs={primary} active="family" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /Family/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Stories/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows a tab's numeric badge only when > 0", () => {
    const badged = primary.map((t) =>
      t.key === "family" ? { ...t, badge: 3 } : t.key === "questions" ? { ...t, badge: 0 } : t,
    );
    render(<BottomTabBar primaryTabs={badged} active="stories" onChange={() => {}} />);
    expect(screen.getByText("3")).toBeTruthy();
    // The 0-badge Questions tab renders no count pill.
    expect(screen.queryByText("0")).toBeNull();
    // The badge is announced with the shared unread aria label.
    expect(screen.getByLabelText(hub.shell.unreadAria(3))).toBeTruthy();
  });

  it("calls onChange with the tab key when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Album/ }));
    expect(onChange).toHaveBeenCalledWith("album");
  });
});
