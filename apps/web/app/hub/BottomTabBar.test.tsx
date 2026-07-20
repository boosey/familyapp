// @vitest-environment jsdom
/**
 * ADR-0025 mobile Phase B — <BottomTabBar> renders the four primary tabs as an icon+label bottom bar
 * with parity to <HubTabs>: same keys, labels, numeric badges, active flag, and `onChange(key)`
 * contract. Increment 3 (#233) adds a 5th "Account" item that is NOT a tab (a menu trigger outside the
 * tablist) — guarded here too. (Routing that wraps `onChange` is exercised in hub-primary-nav.test.tsx.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BottomTabBar } from "./BottomTabBar";
import { hub } from "@/app/_copy";

afterEach(cleanup);

const primary = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  { key: "questions", label: hub.shell.tabQuestions },
];

const account = {
  items: [
    { key: "profile", label: hub.shell.menuProfile, href: "/hub/profile" },
    { key: "settings", label: hub.shell.menuSettings, href: "/hub/settings" },
    { key: "log-out", label: hub.shell.menuLogOut, onSelect: () => {} },
  ],
  clerkSignOut: false,
};

describe("BottomTabBar", () => {
  it("renders all four primary tab keys with their labels", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    for (const t of primary) {
      expect(screen.getByRole("tab", { name: new RegExp(t.label) })).toBeTruthy();
    }
  });

  it("is a <nav> landmark wrapping a tablist of the four tabs", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} />);
    // The landmark is a <nav>; the four tabs live in a tablist inside it.
    expect(screen.getByRole("navigation", { name: hub.shell.bottomNavAria }).tagName).toBe("NAV");
    const tablist = screen.getByRole("tablist", { name: hub.shell.bottomNavAria });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(4);
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

  it("renders NO account item when `account` is omitted (only the four tabs)", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: hub.shell.tabAccount })).toBeNull();
  });

  it("renders a 5th Account item that is NOT a tab (a menu trigger outside the tablist)", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} account={account} />);
    // Still exactly four tabs — the account item is not one of them.
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    const accountBtn = screen.getByRole("button", { name: hub.shell.tabAccount });
    expect(accountBtn.getAttribute("aria-haspopup")).toBe("menu");
    // It is a sibling of the tablist, not inside it.
    const tablist = screen.getByRole("tablist", { name: hub.shell.bottomNavAria });
    expect(within(tablist).queryByRole("button", { name: hub.shell.tabAccount })).toBeNull();
  });

  it("opens the account menu sheet (with its items) when the Account item is tapped", () => {
    render(<BottomTabBar primaryTabs={primary} active="stories" onChange={() => {}} account={account} />);
    // Closed: no dialog.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: hub.shell.tabAccount }));
    // Open: a BottomSheet dialog holds the account menuitems.
    const dialog = screen.getByRole("dialog", { name: hub.shell.accountSheetTitle });
    expect(within(dialog).getByRole("menuitem", { name: hub.shell.menuProfile })).toBeTruthy();
    expect(within(dialog).getByRole("menuitem", { name: hub.shell.menuLogOut })).toBeTruthy();
  });
});
