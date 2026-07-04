// @vitest-environment jsdom
/**
 * StoryComposer — Finish + Finish-check client wiring (ADR-0014 Inc 3 slice 8).
 *  1. A Finish button on the review surface posts the current editor prose to finishDraftAction
 *     (intent="probe").
 *  2. A `finish_offer` response renders an inline dismissible card with the polished preview and two
 *     actions: [Use polished version] (accept) and a dismiss (decline).
 *  3. [Use polished version] re-invokes with intent="accept" carrying the polished text +
 *     modelId/promptText echoed from the offer; dismiss re-invokes with intent="decline".
 *  4. A `finished` response refreshes.
 * Mocks the server actions module (a "use server" file that pulls getRuntime()/db at import time).
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

type FinishStep =
  | {
      kind: "finish_offer";
      storyId: string;
      polished: string;
      polishModelId: string;
      polishPromptText: string;
    }
  | { kind: "finished"; storyId: string }
  | { error: string };

// Scripts finishDraftAction: the first (probe) call returns an offer; subsequent (accept/decline)
// calls return `finished`. Records every call's FormData for assertions.
const finishDraftAction = vi.fn(async (fd: FormData): Promise<FinishStep> => {
  const intent = fd.get("intent");
  if (intent === "probe") {
    return {
      kind: "finish_offer",
      storyId: STORY_ID,
      polished: POLISHED,
      polishModelId: "mock-claude",
      polishPromptText: "the polish system prompt",
    };
  }
  return { kind: "finished", storyId: STORY_ID };
});

vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: vi.fn(),
  getAnswerStatusAction: vi.fn(),
  recordFollowUpTakeAction: vi.fn(),
  appendTypedTakeAction: vi.fn(),
  declineFollowUpAction: vi.fn(),
  dropTakeAction: vi.fn(),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: vi.fn(),
  finishDraftAction: (fd: FormData) => finishDraftAction(fd),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ADR-0014 Inc 3 slice 10: Finish now lives on the DRAFT composing surface (relocated off the shrunk
// pending_approval review), so the draft under test is `draft`-state.
const draft: DraftInfo = {
  storyId: STORY_ID,
  recordedAt: new Date(0).toISOString(),
  mediaUrl: "",
  prose: "The body of the story.",
  title: "Auto Title",
  state: "draft",
  takes: [],
};

describe("StoryComposer Finish-check", () => {
  it("Finish posts the current editor prose with intent=probe and shows the offer card", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);

    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));

    await waitFor(() => expect(finishDraftAction).toHaveBeenCalledTimes(1));
    const probeForm = finishDraftAction.mock.calls[0]![0] as FormData;
    expect(probeForm.get("intent")).toBe("probe");
    expect(probeForm.get("storyId")).toBe(STORY_ID);
    expect(probeForm.get("prose")).toBe("The body of the story.");

    // The offer card renders the polished preview + both actions.
    await waitFor(() => expect(screen.getByText(POLISHED)).toBeTruthy());
    expect(screen.getByRole("button", { name: hub.answer.usePolishedVersion })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.answer.dismissFinishCheck })).toBeTruthy();
  });

  it("[Use polished version] re-invokes with intent=accept echoing the polished text + provenance", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));
    await waitFor(() => expect(screen.getByText(POLISHED)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: hub.answer.usePolishedVersion }));

    await waitFor(() => expect(finishDraftAction).toHaveBeenCalledTimes(2));
    const acceptForm = finishDraftAction.mock.calls[1]![0] as FormData;
    expect(acceptForm.get("intent")).toBe("accept");
    expect(acceptForm.get("storyId")).toBe(STORY_ID);
    expect(acceptForm.get("polished")).toBe(POLISHED);
    expect(acceptForm.get("polishModelId")).toBe("mock-claude");
    expect(acceptForm.get("polishPromptText")).toBe("the polish system prompt");
    // The finished step refreshes the surface.
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // REGRESSION (cold-review finding 1): the server persists the POLISHED text as finalText, so the
    // client editor MUST sync to it. Otherwise proseDraft stays the pre-polish text and, since the
    // draft→pending_approval transition does not remount, Share would send the stale pre-polish prose
    // as `correctedProse` and silently overwrite the just-accepted polish.
    const editor = screen.getByRole("textbox", {
      name: /your story, in your words/i,
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe(POLISHED));
  });

  it("editing the prose while an offer is up drops the stale offer (no way to accept it)", async () => {
    // Data-loss guard: the polished preview reflects the prose AT PROBE TIME. If the narrator keeps
    // typing, accepting the stale offer would silently drop the new words. Editing must invalidate the
    // offer → revert to the plain Finish button, forcing a re-probe on the current text.
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));
    await waitFor(() => expect(screen.getByText(POLISHED)).toBeTruthy());

    // The narrator adds an important new detail after the offer appeared. Target the prose editor
    // specifically (the review phase also has a title textbox) via its stable aria-label.
    const editor = screen.getByRole("textbox", {
      name: /your story, in your words/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: "The body of the story. Plus an important new detail." },
    });

    // The offer card (and its accept button) are GONE — the stale polish can no longer be accepted.
    await waitFor(() => expect(screen.queryByText(POLISHED)).toBeNull());
    expect(screen.queryByRole("button", { name: hub.answer.usePolishedVersion })).toBeNull();
    // The plain Finish button is back so the narrator can re-probe on the edited text.
    expect(screen.getByRole("button", { name: hub.answer.finish })).toBeTruthy();
  });

  it("dismiss re-invokes with intent=decline and clears the offer card", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: hub.answer.finish }));
    await waitFor(() => expect(screen.getByText(POLISHED)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: hub.answer.dismissFinishCheck }));

    await waitFor(() => expect(finishDraftAction).toHaveBeenCalledTimes(2));
    const declineForm = finishDraftAction.mock.calls[1]![0] as FormData;
    expect(declineForm.get("intent")).toBe("decline");
    expect(declineForm.get("storyId")).toBe(STORY_ID);
    // The card is gone after dismiss.
    await waitFor(() => expect(screen.queryByText(POLISHED)).toBeNull());
  });
});
