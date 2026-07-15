// @vitest-environment jsdom
/**
 * Behavior test for <HubTabsNav> — the hub header top tab bar.
 *
 * Asserts: the tab bar renders the "Family" tab, and EVERY tab (Family included — it used to be the
 * standalone /hub/tree route) activates via the in-page `/hub?tab=<key>` route now, preserving the
 * shared `?families=` browse filter (ADR-0021) when present and OMITTING it when absent.
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
    render(<HubTabsNav tabs={TABS} active="stories" familiesParam={null} />);
    expect(screen.getByRole("tab", { name: "Family" })).toBeTruthy();
  });

  it("routes the Family tab preserving the ?families= filter when present", () => {
    render(<HubTabsNav tabs={TABS} active="stories" familiesParam="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=family&families=fam-marino");
  });

  it("routes other tabs on the same in-page ?tab= route, preserving the filter", () => {
    render(<HubTabsNav tabs={TABS} active="stories" familiesParam="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Album" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album&families=fam-marino");
  });

  it("OMITS the ?families= param when the filter is absent (absent = all)", () => {
    render(<HubTabsNav tabs={TABS} active="stories" familiesParam={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Album" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album");
  });
});
