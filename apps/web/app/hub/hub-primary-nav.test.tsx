// @vitest-environment jsdom
/**
 * ADR-0025 mobile Phase B, Increment 1 — <HubPrimaryNav> swaps the primary nav by viewport:
 *  - desktop (useIsCompact === false, the server + first-paint contract) → the top HubTabs pill row,
 *    NO bottom bar;
 *  - phone (true) → the fixed BottomTabBar (portaled to document.body so it escapes the transformed
 *    sticky header — see the portal-escape test below), and the top pill row is NOT mounted.
 * Both branches share ONE navigation behaviour: a `/hub?tab=<key>` push that preserves `?families=`
 * when present and omits it when absent. `useIsCompact` and `useRouter` are mocked so we can drive each
 * branch and assert the target without a real viewport / router.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HubPrimaryNav } from "./HubPrimaryNav";
import { hub } from "@/app/_copy";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// Mutable so each test picks the branch. The module default is false (desktop), matching the hook's
// SSR/first-paint contract.
let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({
  useIsCompact: () => compact,
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  compact = false;
});

const PRIMARY = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  { key: "questions", label: hub.shell.tabQuestions },
];

describe("HubPrimaryNav viewport branch", () => {
  it("renders the top HubTabs pill row on desktop (no bottom bar)", () => {
    compact = false;
    render(<HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam={null} />);
    // Desktop nav landmark is the top-tabs sectionsAria; the bottom-nav landmark is absent.
    expect(screen.getByRole("tablist", { name: hub.shell.sectionsAria })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: hub.shell.bottomNavAria })).toBeNull();
  });

  it("renders the fixed BottomTabBar on a phone (no top pill row)", () => {
    compact = true;
    render(<HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam={null} />);
    expect(screen.getByRole("tablist", { name: hub.shell.bottomNavAria })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: hub.shell.sectionsAria })).toBeNull();
  });

  it("portals the compact BottomTabBar to document.body (escapes the transformed sticky header)", () => {
    // REGRESSION (ADR-0025 Inc 2): the collapse-on-scroll header uses transform/will-change, which makes
    // it the containing block for `position: fixed` descendants. Rendered in place, the fixed bottom bar
    // would be positioned relative to the header (top of screen, sliding away) instead of the viewport.
    // The portal to document.body is what fixes it. This test FAILS without the portal (the bar would be
    // a descendant of the host) and PASSES with it (the bar is in body, not under the host).
    compact = true;
    const { container } = render(
      <div data-testid="nav-host">
        <HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam={null} />
      </div>,
    );
    const host = within(container).getByTestId("nav-host");
    // The bar exists in the document…
    const bar = screen.getByRole("tablist", { name: hub.shell.bottomNavAria });
    expect(bar).toBeTruthy();
    // …but is NOT a DOM descendant of the wrapper's render container — it was portaled to <body>.
    expect(within(host).queryByRole("tablist", { name: hub.shell.bottomNavAria })).toBeNull();
    expect(host.contains(bar)).toBe(false);
    expect(document.body.contains(bar)).toBe(true);
  });

  it("routes preserving the ?families= filter when present (desktop)", () => {
    compact = false;
    render(<HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: "Album" }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album&families=fam-marino");
  });

  it("routes preserving the ?families= filter when present (compact)", () => {
    compact = true;
    render(<HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam="fam-marino" />);
    fireEvent.click(screen.getByRole("tab", { name: /Album/ }));
    expect(push).toHaveBeenCalledWith("/hub?tab=album&families=fam-marino");
  });

  it("OMITS the ?families= param when the filter is absent (absent = all)", () => {
    compact = true;
    render(<HubPrimaryNav primaryTabs={PRIMARY} active="stories" familiesParam={null} />);
    fireEvent.click(screen.getByRole("tab", { name: /Family/ }));
    expect(push).toHaveBeenCalledWith("/hub?tab=family");
  });
});
