// @vitest-environment jsdom
/**
 * QuestionsSubNav (#297) — progressive hub control row for Questions. Thin wiring: Sub tabs only,
 * single progressive row (no HubToolbar / compact-strip branch), badge + routing preserved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QuestionsSubNav } from "./QuestionsSubNav";
import { hub } from "@/app/_copy";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function visibleRow(): HTMLElement {
  const row = document.querySelector("[data-hub-progressive-control-row]");
  if (!(row instanceof HTMLElement)) throw new Error("missing progressive row");
  return row;
}

describe("QuestionsSubNav progressive control row (#297)", () => {
  it("renders the three ask sub-tabs as pills inside the progressive row", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(document.querySelectorAll("[data-hub-progressive-control-row]")).toHaveLength(1);
    expect(document.querySelector("[data-hub-toolbar]")).toBeNull();
    const row = within(visibleRow());
    expect(row.getByRole("navigation", { name: hub.shell.questionsSubNavAria })).toBeTruthy();
    expect(row.getByText(hub.shell.questionsSubToAnswer)).toBeTruthy();
    expect(row.getByText(hub.shell.questionsSubAsk)).toBeTruthy();
    expect(row.getByText(hub.shell.questionsSubYourAsks)).toBeTruthy();
    expect(row.getByText(hub.shell.questionsSubToAnswer).closest("button")).toBeTruthy();
  });

  it("uses the short 'Ask' label (not the long 'Ask a question') for the middle pill", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(hub.shell.questionsSubAsk).toBe("Ask");
    expect(within(visibleRow()).getByText("Ask")).toBeTruthy();
    expect(within(visibleRow()).queryByText("Ask a question")).toBeNull();
  });

  it("Sub tabs only — no Family/Search/Filters/Views and no trailing action", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={2} />);
    const row = visibleRow();
    expect(row.getAttribute("data-family")).toBe("none");
    expect(row.getAttribute("data-search")).toBe("none");
    expect(row.getAttribute("data-filters")).toBe("none");
    expect(row.getAttribute("data-views")).toBe("none");
    expect(row.getAttribute("data-action")).toBe("none");
    expect(within(row).getAllByRole("button").length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByRole("link")).toBeNull();
  });

  it("badges the To-answer sub-link with the pending-ask count", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={3} />);
    const row = within(visibleRow());
    const badge = row.getByText("3");
    expect(badge.getAttribute("aria-label")).toBe(hub.shell.unreadAria(3));
    expect(row.getByText(hub.shell.questionsSubToAnswer).closest("button")).toBe(
      badge.closest("button"),
    );
  });

  it("hides the badge at 0 or undefined", () => {
    const { rerender } = render(
      <QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={0} />,
    );
    expect(within(visibleRow()).queryByText(/^\d+$/)).toBeNull();
    rerender(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(within(visibleRow()).queryByText(/^\d+$/)).toBeNull();
  });

  it("marks the active sub-tab with aria-current=page", () => {
    render(<QuestionsSubNav active="ask" familiesParam={null} />);
    const row = within(visibleRow());
    expect(row.getByText(hub.shell.questionsSubAsk).closest("button")!.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      row.getByText(hub.shell.questionsSubToAnswer).closest("button")!.getAttribute("aria-current"),
    ).toBeNull();
  });

  it("routes to a sub-tab, preserving ?families= when present", () => {
    render(<QuestionsSubNav active="questions" familiesParam="fam-marino" toAnswerBadge={2} />);
    fireEvent.click(within(visibleRow()).getByText(hub.shell.questionsSubAsk));
    expect(push).toHaveBeenCalledWith("/hub?tab=ask&families=fam-marino");
  });

  it("OMITS ?families= from the route when the filter is absent", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    fireEvent.click(within(visibleRow()).getByText(hub.shell.questionsSubYourAsks));
    expect(push).toHaveBeenCalledWith("/hub?tab=asks");
  });

  it("menu-icon stage still routes via router.push", () => {
    render(
      <QuestionsSubNav
        active="questions"
        familiesParam="fam-a"
        forceAvailableWidth={40}
        forceWidths={{
          subTabs: { labeled: 200, iconPills: 160, menuIcon: 40 },
        }}
      />,
    );
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-sub-tabs"),
    ).toBe("menu-icon");
    fireEvent.click(screen.getByRole("button", { name: hub.shell.questionsSubNavAria }));
    fireEvent.click(screen.getByRole("menuitem", { name: hub.shell.questionsSubAsk }));
    expect(push).toHaveBeenCalledWith("/hub?tab=ask&families=fam-a");
  });
});
