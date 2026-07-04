// @vitest-environment jsdom
/**
 * Integration test: the follow-up thread loop in AnswerFlow (Task 7).
 *  1. An initial answer that resolves to a `follow_up` step shows the follow-up prompt + the
 *     peer-level "That's all for now" finish button.
 *  2. Tapping "That's all for now" runs finishThreadAction → `ready` → polls status → refreshes.
 *  3. A draft with multiple takes renders a per-take relisten list, with a "Remove this part" drop
 *     only on the follow-up take (never on the initial answer).
 * Mocks the browser media stack (getUserMedia, MediaRecorder, object URLs) and the server actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryComposer } from "@/app/hub/StoryComposer";
import type { DraftInfo } from "@/app/hub/StoryComposer";

const ASK = {
  id: "11834dd1-04f4-44a4-b611-24fdd9c3d8fd",
  questionText: "What have you learned about being a grandparent?",
  askerName: "Sam",
};

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const STORY_ID = "s1";

type Step =
  | { kind: "follow_up"; storyId: string; prompt: string }
  | { kind: "ready"; storyId: string }
  | { kind: "discarded" }
  | { error: string };

const composeStoryAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "follow_up",
  storyId: STORY_ID,
  prompt: "Tell me about the stained glass.",
}));
const recordFollowUpTakeAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "ready",
  storyId: STORY_ID,
}));
const finishThreadAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "ready",
  storyId: STORY_ID,
}));
const dropTakeAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "ready",
  storyId: STORY_ID,
}));
const getAnswerStatusAction = vi.fn(
  async (..._a: unknown[]): Promise<{ status: "processing" | "ready"; storyId: string }> => ({
    status: "ready",
    storyId: STORY_ID,
  }),
);

vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: (...args: unknown[]) => composeStoryAction(...args),
  recordFollowUpTakeAction: (...args: unknown[]) => recordFollowUpTakeAction(...args),
  finishThreadAction: (...args: unknown[]) => finishThreadAction(...args),
  dropTakeAction: (...args: unknown[]) => dropTakeAction(...args),
  getAnswerStatusAction: (...args: unknown[]) => getAnswerStatusAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
}));

// The review phase mounts StoryPhotosEditor (a "use server" module that pulls getRuntime()/db).
// Mock it to an empty editor so this test doesn't boot the real dev runtime.
vi.mock("@/app/hub/answer/[askId]/photo-actions", () => ({
  loadStoryPhotoEditorAction: vi.fn(async () => ({ ok: true, attached: [], album: [] })),
  attachStoryPhotoAction: vi.fn(),
  detachStoryPhotoAction: vi.fn(),
  setStoryCoverAction: vi.fn(),
  reorderStoryPhotosAction: vi.fn(),
}));

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state = "inactive";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public stream: any) {}
  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  URL.createObjectURL = vi.fn(() => "blob:local-take");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Drive the voice button through idle → listening → stop (fires onstop → uploadRecording). Targets
 * the voice button by its aria-label so it works on the follow-up screen too (which also has the
 * "That's all for now" button). */
async function recordOnce() {
  fireEvent.click(screen.getByRole("button", { name: /Tap to speak/ })); // idle → listening
  await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Listening/ })); // listening → stop
}

describe("StoryComposer follow-up loop", () => {
  it("shows the follow-up prompt and 'That's all for now' after a follow_up step", async () => {
    render(
      <StoryComposer mode="answer" ask={ASK} draft={null} />,
    );

    await recordOnce();

    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );
    expect(composeStoryAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /That's all for now/ })).toBeTruthy();
  });

  it("finishes the thread when 'That's all for now' is tapped → polls + refreshes", async () => {
    render(
      <StoryComposer mode="answer" ask={ASK} draft={null} />,
    );

    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /That's all for now/ }));

    await waitFor(() => expect(finishThreadAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(getAnswerStatusAction).toHaveBeenCalledWith(STORY_ID);
  });

  it("renders a per-take relisten list with a drop only on the follow-up take", () => {
    const draft: DraftInfo = {
      storyId: STORY_ID,
      recordedAt: new Date().toISOString(),
      mediaUrl: "/api/media/m0",
      prose: "The stitched prose of both takes.",
      title: "The chapel window",
      takes: [
        { position: 0, mediaUrl: "/api/media/m0", isInitial: true },
        { position: 1, mediaUrl: "/api/media/m1", isInitial: false },
      ],
    };

    render(
      <StoryComposer mode="answer" ask={ASK} draft={draft} />,
    );

    // Two labelled relisten controls, one per take.
    const audios = document.querySelectorAll("audio");
    expect(audios).toHaveLength(2);
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.getByText("Follow-up")).toBeTruthy();

    // The drop appears ONLY on the follow-up take, never on the initial answer.
    const drops = screen.getAllByRole("button", { name: /Remove this part/ });
    expect(drops).toHaveLength(1);
  });

  it("re-enables the review controls after dropping a follow-up take (op reset)", async () => {
    const draft: DraftInfo = {
      storyId: STORY_ID,
      recordedAt: new Date().toISOString(),
      mediaUrl: "/api/media/m0",
      prose: "The stitched prose of both takes.",
      title: "The chapel window",
      takes: [
        { position: 0, mediaUrl: "/api/media/m0", isInitial: true },
        { position: 1, mediaUrl: "/api/media/m1", isInitial: false },
      ],
    };

    render(
      <StoryComposer mode="answer" ask={ASK} draft={draft} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove this part/ }));

    // The drop targets the follow-up take (position 1).
    await waitFor(() => expect(dropTakeAction).toHaveBeenCalledOnce());
    const form = dropTakeAction.mock.calls[0]![0] as FormData;
    expect(form.get("position")).toBe("1");
    expect(form.get("storyId")).toBe(STORY_ID);

    // After the mocked `{kind:"ready"}` resolves, the controls must be RE-ENABLED (op reset). Without
    // the fix, `op` stays "drop" forever (storyId is unchanged so no keyed remount) → Share disabled.
    const share = screen.getByRole("button", { name: /Share with family/ }) as HTMLButtonElement;
    await waitFor(() => expect(share.disabled).toBe(false));
  });

  it("surfaces a finish-thread error on the follow-up screen (never a silent dead end)", async () => {
    finishThreadAction.mockResolvedValueOnce({ error: "Could not finish. Please try again." });

    render(
      <StoryComposer mode="answer" ask={ASK} draft={null} />,
    );

    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /That's all for now/ }));

    await waitFor(() => expect(finishThreadAction).toHaveBeenCalledOnce());
    // The error is visibly rendered on the follow-up screen; refresh never fired.
    await waitFor(() =>
      expect(screen.getByText(/Could not finish\. Please try again\./)).toBeTruthy(),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("records a follow-up take via recordFollowUpTakeAction (not composeStoryAction)", async () => {
    render(
      <StoryComposer mode="answer" ask={ASK} draft={null} />,
    );

    // Initial answer → follow_up screen.
    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );
    expect(composeStoryAction).toHaveBeenCalledOnce();

    // Record the follow-up take → the FOLLOW-UP action fires against the active story, not the
    // initial compose action.
    await recordOnce();
    await waitFor(() => expect(recordFollowUpTakeAction).toHaveBeenCalledOnce());
    const form = recordFollowUpTakeAction.mock.calls[0]![0] as FormData;
    expect(form.get("storyId")).toBe(STORY_ID);
    expect(composeStoryAction).toHaveBeenCalledOnce(); // still only the initial answer
  });
});
