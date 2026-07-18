// @vitest-environment jsdom
/**
 * Issue #124 (Playful de-clutter): <FamilySubNav> is the secondary sub-nav inside the Family primary
 * tab — it switches between the family tree/relatives view and the steward's Requests queue, routing
 * to the SAME `?tab=family|requests` keys and preserving `?families=` the way HubTabsNav does. The
 * Requests sub-link badges the pending-request count. `useRouter` is mocked to assert the target.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FamilySubNav } from "./FamilySubNav";
import { hub } from "@/app/_copy";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("FamilySubNav", () => {
  it("renders both sub-tabs", () => {
    render(<FamilySubNav active="family" familiesParam={null} />);
    expect(screen.getByText(hub.shell.familySubTree)).toBeTruthy();
    expect(screen.getByText(hub.shell.tabRequests)).toBeTruthy();
  });

  it("routes to ?tab=requests, preserving ?families= when present", () => {
    render(<FamilySubNav active="family" familiesParam="fam-marino" />);
    fireEvent.click(screen.getByText(hub.shell.tabRequests));
    expect(push).toHaveBeenCalledWith("/hub?tab=requests&families=fam-marino");
  });

  it("OMITS ?families= when the filter is absent", () => {
    render(<FamilySubNav active="family" familiesParam={null} />);
    fireEvent.click(screen.getByText(hub.shell.tabRequests));
    expect(push).toHaveBeenCalledWith("/hub?tab=requests");
  });

  it("marks the active key with aria-current=page", () => {
    render(<FamilySubNav active="requests" familiesParam={null} />);
    const requests = screen.getByText(hub.shell.tabRequests).closest("button")!;
    const familyTree = screen.getByText(hub.shell.familySubTree).closest("button")!;
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
