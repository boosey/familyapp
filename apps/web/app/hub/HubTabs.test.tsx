// @vitest-environment jsdom
/**
 * Issue #124 (Scrapbook de-clutter): <HubTabs> renders exactly the four primary tabs, each with an
 * optional numeric badge. There is no longer a "＋ Tell a story" CTA and no "More ▾" overflow menu —
 * the two conditional entries moved out of the chrome (Invite → Family surface button; Requests →
 * Family sub-nav, see FamilySubNav).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  it("renders exactly the four primary tabs", () => {
    render(<HubTabs primaryTabs={primary} active="stories" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("renders a tab's numeric badge", () => {
    const badged = primary.map((t) => (t.key === "family" ? { ...t, badge: 3 } : t));
    render(<HubTabs primaryTabs={badged} active="stories" onChange={() => {}} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders no Tell-a-story link", () => {
    render(<HubTabs primaryTabs={primary} active="stories" onChange={() => {}} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders no overflow menu toggle", () => {
    const { container } = render(
      <HubTabs primaryTabs={primary} active="stories" onChange={() => {}} />,
    );
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });
});
