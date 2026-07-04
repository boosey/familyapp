// @vitest-environment jsdom
/**
 * StoryComposer — the generalized capture/review surface (ADR-0007, Task 9).
 *  1. Tell mode (no ask): no question header, and the capture screen offers a voice⇄text toggle.
 *  2. The text path submits the typed telling via composeStoryAction (FormData carries `text`).
 *  3. Review shows an editable title field prepopulated with the derived title.
 * Mocks the server actions module (a "use server" file that pulls getRuntime()/db at import time).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryComposer, type DraftInfo } from "@/app/hub/StoryComposer";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

const composeStoryAction = vi.fn(
  async (..._args: unknown[]): Promise<{ kind: "ready"; storyId: string }> => ({
    kind: "ready",
    storyId: STORY_ID,
  }),
);
const getAnswerStatusAction = vi.fn(
  async (..._args: unknown[]): Promise<{ status: "ready"; storyId: string }> => ({
    status: "ready",
    storyId: STORY_ID,
  }),
);

vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: (...args: unknown[]) => composeStoryAction(...args),
  getAnswerStatusAction: (...args: unknown[]) => getAnswerStatusAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: vi.fn(),
}));

// The review phase mounts StoryPhotosEditor, which loads via this "use server" module (pulls
// getRuntime()/db at import). Mock it so the review-phase tests don't boot the real dev runtime; the
// empty-editor result is enough (these tests assert title/discard behavior, not photos).
vi.mock("@/app/hub/answer/[askId]/photo-actions", () => ({
  loadStoryPhotoEditorAction: vi.fn(
    async (): Promise<{ ok: true; attached: never[]; album: never[] }> => ({
      ok: true,
      attached: [],
      album: [],
    }),
  ),
  attachStoryPhotoAction: vi.fn(),
  detachStoryPhotoAction: vi.fn(),
  setStoryCoverAction: vi.fn(),
  reorderStoryPhotosAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoryComposer capture (tell mode)", () => {
  it("in tell mode with no ask, shows no question header and offers a type toggle", () => {
    render(<StoryComposer mode="tell" ask={null} draft={null} />);
    // No answer-mode question header ("<NAME> ASKED") in a self-initiated telling.
    expect(screen.queryByText(/asked/i)).toBeNull();
    expect(screen.getByRole("button", { name: /type it/i })).toBeTruthy();
  });

  it("type mode submits text via composeStoryAction", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={null} />);

    // Switch to the typed path.
    fireEvent.click(screen.getByRole("button", { name: /type it/i }));

    // Type into the textarea and submit.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "The summer we drove to the coast." } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(composeStoryAction).toHaveBeenCalledOnce());
    const form = composeStoryAction.mock.calls[0]![0] as FormData;
    expect(form.get("text")).toBe("The summer we drove to the coast.");
    // Self-initiated telling → no askId is attached.
    expect(form.get("askId")).toBeNull();
  });
});

describe("StoryComposer review title field", () => {
  const draft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "", // a text story has no audio
    prose: "The body of the story.",
    title: "Auto Title",
    takes: [],
  };

  it("review shows a title field prepopulated with the derived title, editable", () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    const title = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(title.value).toBe("Auto Title");

    // Editable.
    fireEvent.change(title, { target: { value: "A drive to the coast" } });
    expect(title.value).toBe("A drive to the coast");
  });

  it("a text draft (no audio) renders no relisten audio in review", () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    expect(document.querySelector("audio")).toBeNull();
  });
});

describe("StoryComposer discard destination is mode-aware", () => {
  const draft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "",
    prose: "The body of the story.",
    title: "Auto Title",
    takes: [],
  };

  // discardAnswerAction (mocked above) resolves undefined → no `.error` → handleDiscard proceeds to
  // router.push(backTab). backTab is derived from `mode`: tell → Stories tab, answer → Questions tab.
  it("tell-mode discard returns to the Stories tab", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub?tab=stories"));
  });

  it("answer-mode discard returns to the Questions tab (no regression)", async () => {
    render(
      <StoryComposer
        mode="answer"
        ask={{ id: "ask1", questionText: "What was Sunday like?", askerName: "Mom" }}
        draft={draft}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub?tab=questions"));
  });
});
