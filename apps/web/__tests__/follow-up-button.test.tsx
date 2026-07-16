// @vitest-environment jsdom
/**
 * FollowUpButton (#77) — the "Ask a follow-up" affordance on a published story.
 *
 * Focus: while the submit transition is in flight (`isPending`), the question textarea must be
 * DISABLED so the text can't be edited mid-send (Gemini review, PR #82). We drive this by making the
 * mocked `askFollowUpAction` hang on a promise we resolve by hand, submit the form, and assert the
 * textarea is disabled while pending and re-enabled once the action rejects/returns an error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FollowUpButton } from "@/app/hub/stories/[id]/FollowUpButton";
import { hub } from "@/app/_copy";

const askFollowUpAction = vi.fn();
vi.mock("@/app/hub/stories/[id]/actions", () => ({
  askFollowUpAction: (fd: FormData) => askFollowUpAction(fd),
}));

afterEach(() => {
  cleanup();
  askFollowUpAction.mockReset();
});

function openForm() {
  render(<FollowUpButton storyId="s1" targetPersonId="narrator-1" narratorName="Eleanor" />);
  fireEvent.click(screen.getByTestId("follow-up-open"));
}

describe("FollowUpButton — textarea disabled while sending", () => {
  it("disables the question textarea during the pending transition, re-enables after it settles", async () => {
    // Hold the action open so the transition stays pending until we resolve it.
    let resolveAction!: (v: { error: string }) => void;
    askFollowUpAction.mockReturnValue(
      new Promise<{ error: string }>((resolve) => {
        resolveAction = resolve;
      }),
    );

    openForm();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);

    fireEvent.change(textarea, { target: { value: "What happened to the house?" } });
    fireEvent.submit(screen.getByTestId("follow-up-form"));

    // In-flight: the textarea is locked so the text can't change mid-send.
    await waitFor(() => expect(textarea.disabled).toBe(true));

    // Settle the action (with an error so the form stays mounted) — the textarea unlocks again.
    resolveAction({ error: hub.followUp.failed });
    await waitFor(() => expect(textarea.disabled).toBe(false));
  });
});
