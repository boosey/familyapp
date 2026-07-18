// @vitest-environment jsdom
/**
 * FamilySurfaceNav (#158) — the single selector row shared by all three Family sub-tabs: Family tree ·
 * List · Requests, with a right-justified Invite. Selection is URL-driven, so each selector item is a
 * real `<Link>` (asserted on rendered `<a href>` targets); `?families=` is preserved (omitted when
 * absent), the Requests item is gated by `showRequests` and badges the aggregate pending count, and the
 * Invite button appears only when an `inviteHref` is given.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FamilySurfaceNav } from "./FamilySurfaceNav";
import { hub } from "@/app/_copy";

afterEach(() => cleanup());

const TREE = hub.shell.familySubTree;
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
});
