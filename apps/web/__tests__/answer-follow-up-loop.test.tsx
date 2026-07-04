// @vitest-environment jsdom
/**
 * Integration test: the follow-up thread loop on the collapsed composing surface (ADR-0014 Inc 3
 * slice 10). The follow-up is now an INLINE banner on the always-mounted composing surface (not a
 * full-screen takeover):
 *  1. An initial answer that resolves to a `follow_up` step lands on the composing surface (prose
 *     editor mounted, seeded with the take's words) with the follow-up prompt banner + a peer-level
 *     "That's all for now".
 *  2. Tapping "That's all for now" runs declineFollowUpAction → clears the banner WITHOUT a refresh
 *     (non-clobbering) and stays composing.
 *  3. Recording again on the composing surface posts a follow-up take via recordFollowUpTakeAction.
 *  4. A draft with multiple takes renders a per-take relisten list, with a "Remove this part" drop
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
  | { kind: "follow_up"; storyId: string; prompt: string; prose: string; appendedSegment: string }
  | { kind: "appended"; storyId: string; prose: string; appendedSegment: string }
  | { kind: "take_dropped"; storyId: string }
  | { kind: "discarded" }
  | { error: string };

// Take 0 proposes a follow-up (now carrying the appended prose so the mounted editor can seed it).
const composeStoryAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "follow_up",
  storyId: STORY_ID,
  prompt: "Tell me about the stained glass.",
  prose: "My grandmother's house.",
  appendedSegment: "My grandmother's house.",
}));
const recordFollowUpTakeAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "appended",
  storyId: STORY_ID,
  prose: "My grandmother's house. And its stained glass.",
  appendedSegment: "And its stained glass.",
}));
// Decline: an appended step with an EMPTY segment (records the skip, echoes the client prose).
const declineFollowUpAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "appended",
  storyId: STORY_ID,
  prose: "My grandmother's house.",
  appendedSegment: "",
}));
const dropTakeAction = vi.fn(async (..._a: unknown[]): Promise<Step> => ({
  kind: "take_dropped",
  storyId: STORY_ID,
}));

vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: (...args: unknown[]) => composeStoryAction(...args),
  recordFollowUpTakeAction: (...args: unknown[]) => recordFollowUpTakeAction(...args),
  appendTypedTakeAction: vi.fn(),
  declineFollowUpAction: (...args: unknown[]) => declineFollowUpAction(...args),
  finishDraftAction: vi.fn(),
  dropTakeAction: (...args: unknown[]) => dropTakeAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: vi.fn(),
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
 * the voice button by its aria-label so it works on the composing footer too. */
async function recordOnce() {
  fireEvent.click(screen.getByRole("button", { name: /Tap to speak/ })); // idle → listening
  await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Listening/ })); // listening → stop
}

describe("StoryComposer follow-up loop (inline banner)", () => {
  it("shows the follow-up banner + 'That's all for now' on the composing surface after a follow_up step", async () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    await recordOnce();

    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );
    expect(composeStoryAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /That's all for now/ })).toBeTruthy();
    // The composing editor is mounted, seeded with the appended prose (client-optimistic, no refresh).
    const editor = screen.getByRole("textbox", {
      name: /your story, in your words/i,
    }) as HTMLTextAreaElement;
    expect(editor.value).toBe("My grandmother's house.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("'That's all for now' declines via declineFollowUpAction, drops the banner, and does NOT refresh", async () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /That's all for now/ }));

    await waitFor(() => expect(declineFollowUpAction).toHaveBeenCalledOnce());
    // The client posts its current editor text (non-clobbering echo).
    const form = declineFollowUpAction.mock.calls[0]![0] as FormData;
    expect(form.get("storyId")).toBe(STORY_ID);
    expect(form.get("prose")).toBe("My grandmother's house.");
    // The banner is gone; we stay on the composing surface (the editor is still mounted).
    await waitFor(() =>
      expect(screen.queryByText("Tell me about the stained glass.")).toBeNull(),
    );
    expect(
      screen.getByRole("textbox", { name: /your story, in your words/i }),
    ).toBeTruthy();
    // Decline (empty segment) never refreshes — that would remount and clobber unsaved edits.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("records a follow-up take via recordFollowUpTakeAction from the composing footer", async () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    // Initial answer → composing surface with the follow-up banner.
    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );
    expect(composeStoryAction).toHaveBeenCalledOnce();

    // Record again on the composing footer → the FOLLOW-UP action fires against the active story.
    await recordOnce();
    await waitFor(() => expect(recordFollowUpTakeAction).toHaveBeenCalledOnce());
    const form = recordFollowUpTakeAction.mock.calls[0]![0] as FormData;
    expect(form.get("storyId")).toBe(STORY_ID);
    expect(form.get("prose")).toBe("My grandmother's house.");
    expect(composeStoryAction).toHaveBeenCalledOnce(); // still only the initial answer
  });

  it("surfaces a decline error on the composing surface (never a silent dead end)", async () => {
    declineFollowUpAction.mockResolvedValueOnce({ error: "Could not finish. Please try again." });

    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    await recordOnce();
    await waitFor(() =>
      expect(screen.getByText("Tell me about the stained glass.")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /That's all for now/ }));

    await waitFor(() => expect(declineFollowUpAction).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText(/Could not finish\. Please try again\./)).toBeTruthy(),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("StoryComposer per-take relisten (draft composing)", () => {
  const draft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date().toISOString(),
    mediaUrl: "/api/media/m0",
    prose: "The prose of both takes.",
    title: "The chapel window",
    state: "draft",
    takes: [
      { position: 0, mediaUrl: "/api/media/m0", isInitial: true },
      { position: 1, mediaUrl: "/api/media/m1", isInitial: false },
    ],
  };

  it("renders a per-take relisten list with a drop only on the follow-up take", () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={draft} />);

    const audios = document.querySelectorAll("audio");
    expect(audios).toHaveLength(2);
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.getByText("Follow-up")).toBeTruthy();

    const drops = screen.getAllByRole("button", { name: /Remove this part/ });
    expect(drops).toHaveLength(1);
  });

  it("dropping a follow-up take (audio-only) shows the decision-(d) notice, refreshes, keeps the prose", async () => {
    const KEPT_PROSE = "The prose of both takes.";
    render(<StoryComposer mode="answer" ask={ASK} draft={draft} />);

    fireEvent.click(screen.getByRole("button", { name: /Remove this part/ }));

    await waitFor(() => expect(dropTakeAction).toHaveBeenCalledOnce());
    const form = dropTakeAction.mock.calls[0]![0] as FormData;
    expect(form.get("position")).toBe("1");
    expect(form.get("storyId")).toBe(STORY_ID);

    await waitFor(() =>
      expect(screen.getByText(/Recording removed — edit the text above/)).toBeTruthy(),
    );
    expect(refresh).toHaveBeenCalledOnce();

    // The prose editor text is UNTOUCHED (the words are kept on purpose).
    const editor = screen.getByRole("textbox", {
      name: /your story, in your words/i,
    }) as HTMLTextAreaElement;
    expect(editor.value).toBe(KEPT_PROSE);
  });
});
