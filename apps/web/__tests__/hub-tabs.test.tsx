// @vitest-environment jsdom
/**
 * Behavior test for <HubTabsNav> — the hub header top tab bar.
 *
 * Asserts: the tab bar renders the "Family" tab, and EVERY tab (Family included — it used to be the
 * standalone /hub/tree route) activates via the in-page `/hub?tab=<key>&scope=<scope>` route now.
 * `useRouter` is mocked so we can assert the navigation target without a real router.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HubTabsNav } from "@/app/hub/HubTabsNav";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const TABS = [
  { key: "stories", label: "Stories" },
  { key: "album", label: "Album" },
  { key: "family", label: "Family" },
];

describe("HubTabsNav", () => {
  it("renders a Family tab", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="all" />);
    expect(screen.getByRole("tab", { name: "Family" })).toBeTruthy();
  });

  it("routes the Family tab to the in-page /hub?tab=family route with the scope preserved", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=family&scope=fam-marino");
  });

  it("routes other tabs on the same in-page ?tab= route", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Album" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album&scope=fam-marino");
  });
});
