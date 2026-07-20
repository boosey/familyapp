// @vitest-environment jsdom
/**
 * FamilySurfaceNav (#158) — the single selector row shared by all three Family sub-tabs: Family tree ·
 * List · Requests, with a right-justified Invite. Selection is URL-driven, so each selector item is a
 * real `<Link>` (asserted on rendered `<a href>` targets); `?families=` is preserved (omitted when
 * absent), the Requests item is gated by `showRequests` and badges the aggregate pending count, and the
 * Invite button appears only when an `inviteHref` is given.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FamilySurfaceNav } from "./FamilySurfaceNav";
import { hub } from "@/app/_copy";

let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({ useIsCompact: () => compact }));

afterEach(() => {
  cleanup();
  compact = false;
});

const TREE = hub.shell.familySubTree;
const TREE_SHORT = hub.shell.familySubTreeShort; // compact strip uses the short "Tree" pill label
const LIST = hub.tree.viewList;
const REQUESTS = hub.shell.tabRequests;
const INVITE = hub.shell.tabInvite;

describe("FamilySurfaceNav", () => {
  it("renders Family tree + List as links to ?tab=family&view=…, preserving ?families=", () => {
    render(
      <FamilySurfaceNav active="tree" familiesParam="fam-marino" showRequests={false} />,
    );
    expect(screen.getByText(TREE).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=tree&families=fam-marino",
    );
    expect(screen.getByText(LIST).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=list&families=fam-marino",
    );
  });

  it("OMITS ?families= when the filter is absent", () => {
    render(<FamilySurfaceNav active="tree" familiesParam={null} showRequests={false} />);
    expect(screen.getByText(TREE).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=family&view=tree",
    );
  });

  it("hides the Requests item unless showRequests is set; it links to ?tab=requests", () => {
    const { rerender } = render(
      <FamilySurfaceNav active="tree" familiesParam={null} showRequests={false} />,
    );
    expect(screen.queryByText(REQUESTS)).toBeNull();

    rerender(<FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests />);
    expect(screen.getByText(REQUESTS).closest("a")!.getAttribute("href")).toBe(
      "/hub?tab=requests&families=fam-a",
    );
  });

  it("marks the active item with aria-current=page", () => {
    render(<FamilySurfaceNav active="list" familiesParam={null} showRequests />);
    expect(screen.getByText(LIST).closest("a")!.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText(TREE).closest("a")!.getAttribute("aria-current")).toBeNull();
    expect(screen.getByText(REQUESTS).closest("a")!.getAttribute("aria-current")).toBeNull();
  });

  it("badges Requests with the aggregate pending count; hidden at 0", () => {
    const { rerender } = render(
      <FamilySurfaceNav active="requests" familiesParam={null} showRequests requestsBadge={5} />,
    );
    expect(screen.getByLabelText(hub.shell.unreadAria(5)).textContent).toBe("5");

    rerender(
      <FamilySurfaceNav active="requests" familiesParam={null} showRequests requestsBadge={0} />,
    );
    expect(screen.queryByLabelText(hub.shell.unreadAria(0))).toBeNull();
  });

  it("renders the Invite link right on the row when inviteHref is given, and none otherwise", () => {
    const href = "/hub?tab=invite&families=fam-a";
    const { rerender } = render(
      <FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests inviteHref={href} />,
    );
    expect(screen.getByRole("link", { name: INVITE }).getAttribute("href")).toBe(href);

    rerender(<FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests />);
    expect(screen.queryByRole("link", { name: INVITE })).toBeNull();
  });

  // ── ADR-0025 device round — the compact control strip (Family tab, Pass 2) ─────────────────────────
  describe("compact strip", () => {
    const CHIPS = <div data-testid="fam-chips">chips</div>;
    const inviteHref = "/hub?tab=invite&families=fam-a";

    it("renders the selector pills + Family icon-sheet (chips) + iconified Invite (no View/Filter icon)", () => {
      compact = true;
      render(
        <FamilySurfaceNav
          active="tree"
          familiesParam="fam-a"
          showRequests
          inviteHref={inviteHref}
          row2Left={CHIPS}
        />,
      );
      // Selector pills stay VISIBLE (links). Compact uses the SHORT "Tree" label.
      expect(screen.getByText(TREE_SHORT).closest("a")).not.toBeNull();
      expect(screen.queryByText(TREE)).toBeNull(); // the long "Family tree" is desktop-only
      expect(screen.getByText(LIST).closest("a")).not.toBeNull();
      // The Family icon-sheet trigger is present…
      expect(screen.getByRole("button", { name: hub.mobileControls.familyLabel })).toBeTruthy();
      // …and there is NO View or Filter icon on the Family strip.
      expect(screen.queryByRole("button", { name: hub.mobileControls.viewLabel })).toBeNull();
      expect(screen.queryByRole("button", { name: hub.mobileControls.filterLabel })).toBeNull();
      // Invite is iconified (aria-label), still linking to its href.
      const invite = screen.getByRole("link", { name: hub.shell.inviteAria });
      expect(invite.getAttribute("href")).toBe(inviteHref);
    });

    it("tapping the Family icon opens a sheet holding the chips", () => {
      compact = true;
      render(
        <FamilySurfaceNav active="tree" familiesParam="fam-a" showRequests row2Left={CHIPS} />,
      );
      fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.familyLabel }));
      const dialog = screen.getByRole("dialog", { name: hub.mobileControls.familyLabel });
      expect(within(dialog).getByTestId("fam-chips")).toBeTruthy();
    });

    it("hides the Family icon when there are no chips (Requests tab / <2 families)", () => {
      compact = true;
      // The Requests/no-family path passes no row2Left.
      render(<FamilySurfaceNav active="requests" familiesParam={null} showRequests />);
      expect(screen.queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();
      // The selector pills still render (wayfinding preserved).
      expect(screen.getByText(REQUESTS).closest("a")).not.toBeNull();
    });

    it("still marks the active pill and preserves ?families= on the compact branch", () => {
      compact = true;
      render(
        <FamilySurfaceNav active="list" familiesParam="fam-a" showRequests row2Left={CHIPS} />,
      );
      expect(screen.getByText(LIST).closest("a")!.getAttribute("aria-current")).toBe("page");
      expect(screen.getByText(TREE_SHORT).closest("a")!.getAttribute("href")).toBe(
        "/hub?tab=family&view=tree&families=fam-a",
      );
    });
  });
});
