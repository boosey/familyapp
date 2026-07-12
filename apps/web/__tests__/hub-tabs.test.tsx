// @vitest-environment jsdom
/**
 * Behavior test for <HubTabsNav> — the hub header top tab bar.
 *
 * Asserts: the tab bar renders a "Family tree" tab, and activating it routes to
 * `/hub/tree?scope=<scope>` (its own route, not an in-page ?tab= feed switch),
 * while every other tab still pushes `/hub?tab=<key>&scope=<scope>` unchanged.
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
  { key: "tree", label: "Family tree" },
];

describe("HubTabsNav", () => {
  it("renders a Family tree tab", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="all" />);
    expect(screen.getByRole("tab", { name: "Family tree" })).toBeTruthy();
  });

  it("routes the Family tree tab to /hub/tree with the current scope preserved", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Family tree" }));
    expect(push).toHaveBeenCalledWith("/hub/tree?scope=fam-marino");
  });

  it("leaves non-tree tabs on the in-page ?tab= route unchanged", () => {
    render(<HubTabsNav tabs={TABS} active="stories" scope="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Album" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album&scope=fam-marino");
  });
});
