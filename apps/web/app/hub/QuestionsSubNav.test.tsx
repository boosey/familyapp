// @vitest-environment jsdom
/**
 * #192 — <QuestionsSubNav> renders the three ask sub-tabs (To answer / Ask / Your asks) as a shared
 * {@link HubSubNav} pill row. On DESKTOP it sits in the inline {@link HubToolbar} R1-left (no R1-right,
 * no R2 row). On a PHONE (ADR-0025 device round) it renders in the shared HubControlStrip layout — the
 * same container Stories' Feed/Timeline modeNav uses — so the two selectors read identically, and the
 * shortened "Ask" label keeps the three equal-width pills on ONE line. #142's pending-ask badge on "To
 * answer" and the routing (`router.push`, preserving `?families=`) are unchanged. `useRouter` +
 * `useIsCompact` are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionsSubNav } from "./QuestionsSubNav";
import { hub } from "@/app/_copy";
import strip from "./HubControlStrip.module.css";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({ useIsCompact: () => compact }));

afterEach(() => {
  cleanup();
  push.mockClear();
  compact = false;
});

describe("QuestionsSubNav", () => {
  it("renders the three ask sub-tabs as pills inside the shared sub-nav row", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    // A single labelled <nav> (HubSubNav) hosting the three pills.
    const nav = screen.getByRole("navigation", { name: hub.shell.questionsSubNavAria });
    expect(nav).toBeTruthy();
    expect(screen.getByText(hub.shell.questionsSubToAnswer)).toBeTruthy();
    expect(screen.getByText(hub.shell.questionsSubAsk)).toBeTruthy();
    expect(screen.getByText(hub.shell.questionsSubYourAsks)).toBeTruthy();
    // Button-mode pills (client onSelect nav), not links.
    expect(screen.getByText(hub.shell.questionsSubToAnswer).closest("button")).toBeTruthy();
  });

  it("uses the short 'Ask' label (not the long 'Ask a question') for the middle pill", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(hub.shell.questionsSubAsk).toBe("Ask");
    expect(screen.getByText("Ask")).toBeTruthy();
    // The long primary-tab label is NOT used here.
    expect(screen.queryByText("Ask a question")).toBeNull();
  });

  it("renders in the shared control-strip layout on a phone (matches Stories' modeNav container)", () => {
    compact = true;
    const { container } = render(<QuestionsSubNav active="questions" familiesParam={null} />);
    // The outer element is the shared strip; the pills live in its full-width `.pills` wrapper.
    const stripEl = container.querySelector(`.${strip.strip}`);
    expect(stripEl).not.toBeNull();
    const pills = stripEl!.querySelector(`.${strip.pills}`);
    expect(pills).not.toBeNull();
    // The HubSubNav (its three pill buttons) sits inside the pills wrapper.
    expect(pills!.querySelector("nav")).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("desktop keeps the inline HubToolbar (NOT the strip)", () => {
    compact = false;
    const { container } = render(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(container.querySelector(`.${strip.strip}`)).toBeNull();
  });

  it("renders R1 only — NO R1-right action and NO R2 row", () => {
    const { container } = render(
      <QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={2} />,
    );
    // The toolbar renders exactly one row (R1). HubToolbar's empty-row rule means R2 contributes no
    // element at all when both its slots are null — so no reserved space below the pills.
    const toolbar = container.firstElementChild!;
    expect(toolbar.children.length).toBe(1);
    // No action button/link sits alongside the pill row (only the three pill buttons exist).
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("badges the To-answer sub-link with the pending-ask count", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={3} />);
    const badge = screen.getByText("3");
    expect(badge.getAttribute("aria-label")).toBe(hub.shell.unreadAria(3));
    // The badge sits inside the To-answer pill, not Ask / Your asks.
    expect(screen.getByText(hub.shell.questionsSubToAnswer).closest("button")).toBe(
      badge.closest("button"),
    );
  });

  it("hides the badge at 0 or undefined", () => {
    const { rerender } = render(
      <QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={0} />,
    );
    expect(screen.queryByText(/^\d+$/)).toBeNull();
    rerender(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("marks the active sub-tab with aria-current=page", () => {
    render(<QuestionsSubNav active="ask" familiesParam={null} />);
    expect(
      screen.getByText(hub.shell.questionsSubAsk).closest("button")!.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByText(hub.shell.questionsSubToAnswer)
        .closest("button")!
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("routes to a sub-tab, preserving ?families= when present", () => {
    render(<QuestionsSubNav active="questions" familiesParam="fam-marino" toAnswerBadge={2} />);
    fireEvent.click(screen.getByText(hub.shell.questionsSubAsk));
    expect(push).toHaveBeenCalledWith("/hub?tab=ask&families=fam-marino");
  });

  it("OMITS ?families= from the route when the filter is absent", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    fireEvent.click(screen.getByText(hub.shell.questionsSubYourAsks));
    expect(push).toHaveBeenCalledWith("/hub?tab=asks");
  });
});
