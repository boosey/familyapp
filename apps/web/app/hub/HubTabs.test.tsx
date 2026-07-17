// @vitest-environment jsdom
/**
 * Task 3 (Playful de-clutter): <HubTabs> renders exactly the four primary tabs + a "Tell a story"
 * CTA, and tucks the conditional overflow entries (Invite / Requests) behind a "More ▾" menu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HubTabs } from "./HubTabs";
import { hub } from "@/app/_copy";

afterEach(cleanup);

const primary = [
  { key: "stories", label: hub.shell.tabStories },
  { key: "album", label: hub.shell.tabAlbum },
  { key: "family", label: hub.shell.tabFamily },
  { key: "questions", label: hub.shell.tabQuestions },
];

describe("HubTabs de-clutter", () => {
  it("renders exactly the four primary tabs plus a Tell-a-story CTA", () => {
    render(<HubTabs primaryTabs={primary} overflowTabs={[]} active="stories" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("link", { name: hub.shell.tellCtaAria }).getAttribute("href")).toBe(
      "/hub/tell",
    );
  });

  it("shows no More menu when there are no overflow tabs", () => {
    render(<HubTabs primaryTabs={primary} overflowTabs={[]} active="stories" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: hub.shell.moreAria })).toBeNull();
  });

  it("tucks overflow tabs behind a More menu", () => {
    const onChange = vi.fn();
    render(
      <HubTabs
        primaryTabs={primary}
        overflowTabs={[{ key: "requests", label: hub.shell.tabRequests }]}
        active="stories"
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("tab", { name: hub.shell.tabRequests })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: hub.shell.moreAria }));
    fireEvent.click(screen.getByRole("menuitem", { name: hub.shell.tabRequests }));
    expect(onChange).toHaveBeenCalledWith("requests");
  });
});
