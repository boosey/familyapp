// @vitest-environment jsdom
/**
 * Issue #124 (Playful de-clutter): <FamilySubNav> is the secondary sub-nav inside the Family primary
 * tab — it switches between the family tree/relatives view and the steward's Requests queue, routing
 * to the SAME `?tab=family|requests` keys and preserving `?families=` the way HubTabsNav does. The
 * Requests sub-link badges the pending-request count.
 *
 * Issue #134: the sub-nav is now real `<Link>` navigation, so we assert on rendered `<a href>`
 * targets rather than router-push calls.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FamilySubNav } from "./FamilySubNav";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
});

describe("FamilySubNav", () => {
  it("renders both sub-tabs", () => {
    render(<FamilySubNav active="family" familiesParam={null} />);
    expect(screen.getByText(hub.shell.familySubTree)).toBeTruthy();
    expect(screen.getByText(hub.shell.tabRequests)).toBeTruthy();
  });

  it("links to ?tab=requests, preserving ?families= when present", () => {
    render(<FamilySubNav active="family" familiesParam="fam-marino" />);
    const link = screen.getByText(hub.shell.tabRequests).closest("a")!;
    expect(link.getAttribute("href")).toBe("/hub?tab=requests&families=fam-marino");
  });

  it("OMITS ?families= when the filter is absent", () => {
    render(<FamilySubNav active="family" familiesParam={null} />);
    const link = screen.getByText(hub.shell.tabRequests).closest("a")!;
    expect(link.getAttribute("href")).toBe("/hub?tab=requests");
  });

  it("marks the active key with aria-current=page", () => {
    render(<FamilySubNav active="requests" familiesParam={null} />);
    const requests = screen.getByText(hub.shell.tabRequests).closest("a")!;
    const familyTree = screen.getByText(hub.shell.familySubTree).closest("a")!;
    expect(requests.getAttribute("aria-current")).toBe("page");
    expect(familyTree.getAttribute("aria-current")).toBeNull();
  });

  it("shows the requests badge when > 0", () => {
    render(<FamilySubNav active="family" familiesParam={null} requestsBadge={4} />);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("hides the requests badge when 0 or undefined", () => {
    const { rerender } = render(
      <FamilySubNav active="family" familiesParam={null} requestsBadge={0} />,
    );
    expect(screen.queryByLabelText(hub.shell.unreadAria(0))).toBeNull();
    rerender(<FamilySubNav active="family" familiesParam={null} />);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});
