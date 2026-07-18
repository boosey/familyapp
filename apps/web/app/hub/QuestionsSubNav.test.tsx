// @vitest-environment jsdom
/**
 * #142 — <QuestionsSubNav> badges the "To answer" sub-link with the viewer's pending-ask count
 * (mirroring the top-level Questions primary-tab badge). The badge hides at 0/undefined. The routing
 * behaviour (preserving ?families=) is unchanged; `useRouter` is mocked to assert the target.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("QuestionsSubNav", () => {
  it("renders the three ask sub-tabs", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} />);
    expect(screen.getByText(hub.shell.questionsSubToAnswer)).toBeTruthy();
    expect(screen.getByText(hub.shell.questionsSubAsk)).toBeTruthy();
    expect(screen.getByText(hub.shell.questionsSubYourAsks)).toBeTruthy();
  });

  it("badges the To-answer sub-link with the pending-ask count", () => {
    render(<QuestionsSubNav active="questions" familiesParam={null} toAnswerBadge={3} />);
    const badge = screen.getByText("3");
    expect(badge.getAttribute("aria-label")).toBe(hub.shell.unreadAria(3));
    // The badge sits inside the To-answer sub-link, not Ask / Your asks.
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

  it("routes to a sub-tab, preserving ?families= when present", () => {
    render(<QuestionsSubNav active="questions" familiesParam="fam-marino" toAnswerBadge={2} />);
    fireEvent.click(screen.getByText(hub.shell.questionsSubAsk));
    expect(push).toHaveBeenCalledWith("/hub?tab=ask&families=fam-marino");
  });
});
