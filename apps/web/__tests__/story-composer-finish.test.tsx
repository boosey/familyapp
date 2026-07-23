// @vitest-environment jsdom
/**
 * StoryComposer — Finish client wiring (capture → confirmation).
 * Finish seals as-is (intent="decline") and settles to pending_approval — no polish-offer card
 * on the capture surface. Editor/mic lock during the round-trip; Polish still locks Finish+mic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryComposer, type DraftInfo } from "@/app/hub/StoryComposer";
import { hub } from "@/app/_copy";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";
const POLISHED = "A tidier, polished version the narrator can read back.";

type FinishStep = { kind: "finished"; storyId: string } | { error: string };

const finishDraftAction = vi.fn(async (_fd: FormData): Promise<FinishStep> => {
  return { kind: "finished", storyId: STORY_ID };
});
const polishAnswerProseAction = vi.fn(
  async (_fd: FormData): Promise<{ prose: string }> => ({ prose: POLISHED }),
);

vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: vi.fn(),
  recordFollowUpTakeAction: vi.fn(),
  appendTypedTakeAction: vi.fn(),
  declineFollowUpAction: vi.fn(),
  dropTakeAction: vi.fn(),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: (fd: FormData) => polishAnswerProseAction(fd),
  finishDraftAction: (fd: FormData) => finishDraftAction(fd),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const draft: DraftInfo = {
  storyId: STORY_ID,
  recordedAt: new Date(0).toISOString(),
  mediaUrl: "",
  prose: "The body of the story.",
  title: "Auto Title",
  state: "draft",
  takes: [],
};

describe("StoryComposer Finish", () => {
  it("Finish posts the current editor prose with intent=decline (no polish offer on capture)", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);

    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));

    await waitFor(() => expect(finishDraftAction).toHaveBeenCalledTimes(1));
    const form = finishDraftAction.mock.calls[0]![0] as FormData;
    expect(form.get("intent")).toBe("decline");
    expect(form.get("storyId")).toBe(STORY_ID);
    expect(form.get("prose")).toBe("The body of the story.");

    expect(screen.queryByText(POLISHED)).toBeNull();
    expect(screen.queryByRole("button", { name: hub.answer.usePolishedVersion })).toBeNull();
    expect(screen.queryByRole("button", { name: hub.answer.dismissFinishCheck })).toBeNull();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("locks the editor + mic while a Finish round-trip is in flight (cold-review finding 4)", async () => {
    let resolveFinish: (v: FinishStep) => void = () => {};
    finishDraftAction.mockImplementationOnce(
      () => new Promise<FinishStep>((r) => (resolveFinish = r)),
    );
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);

    const editor = () =>
      screen.getByRole("textbox", { name: /your story, in your words/i }) as HTMLTextAreaElement;
    expect(editor().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));

    await waitFor(() => expect(editor().disabled).toBe(true));
    expect((screen.getByRole("button", { name: /tap to speak/i }) as HTMLButtonElement).disabled).toBe(true);

    resolveFinish({ kind: "finished", storyId: STORY_ID });
    await waitFor(() => expect(editor().disabled).toBe(false));
  });

  it("locks the mic + Finish while a ✨Polish round-trip is in flight (cold-review finding 5)", async () => {
    let resolvePolish: (v: { prose: string }) => void = () => {};
    polishAnswerProseAction.mockImplementationOnce(
      () => new Promise<{ prose: string }>((r) => (resolvePolish = r)),
    );
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);

    const finishBtn = () => screen.getByRole("button", { name: hub.answer.finish }) as HTMLButtonElement;
    expect(finishBtn().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /polish/i }));

    await waitFor(() => expect(finishBtn().disabled).toBe(true));
    expect((screen.getByRole("button", { name: /tap to speak/i }) as HTMLButtonElement).disabled).toBe(true);

    resolvePolish({ prose: POLISHED });
    await waitFor(() => expect(finishBtn().disabled).toBe(false));
  });
});
