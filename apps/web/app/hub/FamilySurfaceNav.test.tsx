// @vitest-environment jsdom
/**
 * FamilySurfaceNav (#297) — progressive hub control row for Family. Thin wiring tests: occupancy,
 * Invite outside collapse, single-row chrome (no HubToolbar / compact-strip branch). Precedence lives
 * in resolveHubControlExpansion.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FamilySurfaceNav } from "./FamilySurfaceNav";
import { hub } from "@/app/_copy";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const TREE_SHORT = hub.shell.familySubTreeShort;
const LIST = hub.tree.viewList;
const REQUESTS = hub.shell.tabRequests;
const INVITE = hub.shell.tabInvite;

function visibleRow(): HTMLElement {
  const row = document.querySelector("[data-hub-progressive-control-row]");
  if (!(row instanceof HTMLElement)) throw new Error("missing progressive row");
  return row;
}

const COLLAPSE_VIEWS = {
  subTabs: { labeled: 120, iconPills: 80, menuIcon: 48 },
  family: { expanded: 200, collapsedIcon: 48 },
  views: { expanded: 160, collapsedIcon: 48 },
  actionLabeled: 120,
  actionIconified: 48,
};

describe("FamilySurfaceNav progressive control row (#297)", () => {
  it("renders Family tree + List as links to ?tab=family&view=…, preserving ?families=", () => {
    render(
      <FamilySurfaceNav active="tree" familiesParam="fam-marino" showRequests={false} />,
    );
    const row = within(visibleRow());
    expect(row.getByText(TREE_SHORT).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=tree&families=fam-marino",
    );
    expect(row.getByText(LIST).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=list&families=fam-marino",
    );
  });

  it("OMITS ?families= when the filter is absent", () => {
    render(<FamilySurfaceNav active="tree" familiesParam={null} showRequests={false} />);
    expect(within(visibleRow()).getByText(TREE_SHORT).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=tree",
    );
  });

  it("hides the Requests item unless showRequests is set; it links to ?tab=requests", () => {
    const { rerender } = render(
      <FamilySurfaceNav active="tree" familiesParam={null} showRequests={false} />,
    );
    expect(within(visibleRow()).queryByText(REQUESTS)).toBeNull();

    rerender(<FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests />);
    expect(within(visibleRow()).getByText(REQUESTS).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=requests&families=fam-a",
    );
  });

  it("marks the active item with aria-current=page", () => {
    render(<FamilySurfaceNav active="list" familiesParam={null} showRequests />);
    const row = within(visibleRow());
    expect(row.getByText(LIST).closest("a")!.getAttribute("aria-current")).toBe("page");
    expect(row.getByText(TREE_SHORT).closest("a")!.getAttribute("aria-current")).toBeNull();
    expect(row.getByText(REQUESTS).closest("a")!.getAttribute("aria-current")).toBeNull();
  });

  it("badges Requests with the aggregate pending count; hidden at 0", () => {
    const { rerender } = render(
      <FamilySurfaceNav active="requests" familiesParam={null} showRequests requestsBadge={5} />,
    );
    expect(within(visibleRow()).getByLabelText(hub.shell.unreadAria(5)).textContent).toBe("5");

    rerender(
      <FamilySurfaceNav active="requests" familiesParam={null} showRequests requestsBadge={0} />,
    );
    expect(within(visibleRow()).queryByLabelText(hub.shell.unreadAria(0))).toBeNull();
  });

  it("renders Invite as the trailing primary action when inviteHref is given", () => {
    const href = "/hub?tab=invite&families=fam-a";
    const { rerender } = render(
      <FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests inviteHref={href} />,
    );
    expect(screen.getByRole("link", { name: INVITE }).getAttribute("href")).toBe(href);
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-action"),
    ).toBe("labeled");

    rerender(<FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests />);
    expect(screen.queryByRole("link", { name: INVITE })).toBeNull();
  });

  it("renders a single progressive control row (not HubToolbar two-row chrome)", () => {
    render(
      <FamilySurfaceNav
        active="tree"
        familiesParam="fam-a"
        showRequests
        inviteHref="/hub?tab=invite"
        row2Left={<div data-testid="fam-chips">chips</div>}
        row2Right={<div data-testid="tree-controls">zoom</div>}
      />,
    );
    expect(document.querySelectorAll("[data-hub-progressive-control-row]")).toHaveLength(1);
    expect(document.querySelector("[data-hub-toolbar]")).toBeNull();
    const row = within(visibleRow());
    expect(row.getByTestId("fam-chips")).toBeTruthy();
    expect(row.getByTestId("tree-controls")).toBeTruthy();
  });

  it("collapses Views before Family; Family IconSheet never badges (single-select scope)", () => {
    render(
      <FamilySurfaceNav
        active="tree"
        familiesParam="fam-a"
        showRequests
        inviteHref="/hub?tab=invite"
        row2Left={<div data-testid="fam-chips">chips</div>}
        row2Right={<div data-testid="tree-controls">zoom</div>}
        forceAvailableWidth={320}
        forceWidths={COLLAPSE_VIEWS}
      />,
    );
    const rowEl = visibleRow();
    expect(rowEl.getAttribute("data-views")).toBe("collapsed-icon");
    expect(rowEl.getAttribute("data-search")).toBe("none");
    expect(rowEl.getAttribute("data-filters")).toBe("none");

    fireEvent.click(within(rowEl).getByRole("button", { name: hub.mobileControls.viewLabel }));
    expect(
      within(screen.getByRole("dialog", { name: hub.mobileControls.viewLabel })).getByTestId(
        "tree-controls",
      ),
    ).toBeTruthy();

    // Force Family collapsed too.
    cleanup();
    render(
      <FamilySurfaceNav
        active="tree"
        familiesParam="fam-a"
        showRequests
        row2Left={<div data-testid="fam-chips">chips</div>}
        forceAvailableWidth={100}
        forceWidths={{
          subTabs: { labeled: 200, iconPills: 80, menuIcon: 48 },
          family: { expanded: 200, collapsedIcon: 48 },
        }}
      />,
    );
    expect(visibleRow().getAttribute("data-family")).toBe("collapsed-icon");
    const familyIcon = within(visibleRow()).getByRole("button", {
      name: hub.mobileControls.familyLabel,
    });
    expect(familyIcon.getAttribute("aria-label")).toBe(hub.mobileControls.familyLabel);
    expect(familyIcon.getAttribute("aria-label")).not.toContain(
      hub.mobileControls.activeCountAria(1),
    );
    fireEvent.click(familyIcon);
    expect(
      within(screen.getByRole("dialog", { name: hub.mobileControls.familyLabel })).getByTestId(
        "fam-chips",
      ),
    ).toBeTruthy();
  });

  it("omits Family and Views units when those slots are absent (Requests / no chips)", () => {
    render(<FamilySurfaceNav active="requests" familiesParam={null} showRequests />);
    const row = visibleRow();
    expect(row.getAttribute("data-family")).toBe("none");
    expect(row.getAttribute("data-views")).toBe("none");
    expect(within(row).queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();
    expect(within(row).queryByRole("button", { name: hub.mobileControls.viewLabel })).toBeNull();
    expect(within(row).getByText(REQUESTS).closest("a")).not.toBeNull();
  });

  it("accepts Family chips on Requests (progressive Family unit present)", () => {
    render(
      <FamilySurfaceNav
        active="requests"
        familiesParam={null}
        showRequests
        row2Left={<div data-testid="fam-chips">chips</div>}
      />,
    );
    const row = visibleRow();
    expect(row.getAttribute("data-family")).toBe("expanded");
    expect(within(row).getByTestId("fam-chips")).toBeTruthy();
    expect(row.getAttribute("data-views")).toBe("none");
  });

  it("menu-icon stage navigates via router.push, preserving ?families=", () => {
    render(
      <FamilySurfaceNav
        active="tree"
        familiesParam="fam-a"
        showRequests
        forceAvailableWidth={80}
        forceWidths={{
          subTabs: { labeled: 200, iconPills: 160, menuIcon: 48 },
        }}
      />,
    );
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-sub-tabs"),
    ).toBe("menu-icon");
    fireEvent.click(screen.getByRole("button", { name: hub.shell.familySubNavAria }));
    fireEvent.click(screen.getByRole("menuitem", { name: LIST }));
    expect(push).toHaveBeenCalledWith("/hub?tab=family&view=list&families=fam-a");
  });

  it("menu-icon stage badges the Modes trigger with the Requests count", () => {
    render(
      <FamilySurfaceNav
        active="tree"
        familiesParam={null}
        showRequests
        requestsBadge={4}
        forceAvailableWidth={80}
        forceWidths={{
          subTabs: { labeled: 200, iconPills: 160, menuIcon: 48 },
        }}
      />,
    );
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-sub-tabs"),
    ).toBe("menu-icon");
    const trigger = screen.getByRole("button", {
      name: `${hub.shell.familySubNavAria}, ${hub.shell.unreadAria(4)}`,
    });
    expect(trigger.textContent).toContain("4");
    fireEvent.click(trigger);
    expect(
      within(screen.getByRole("menu")).getByLabelText(hub.shell.unreadAria(4)).textContent,
    ).toBe("4");
  });
});
