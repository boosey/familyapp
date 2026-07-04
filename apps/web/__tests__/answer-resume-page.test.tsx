// @vitest-environment jsdom
/**
 * ADR-0014 Inc 3 slice 9 (routing relax): the /hub/answer/[askId] page must resume a live `draft`
 * answer — not only a `pending_approval` one — so an appended-but-not-finished answer is reachable,
 * and must thread the story `state` onto the DraftInfo it hands StoryComposer (Slice 10 keys phases
 * off it). Pre-existing gates (anonymous, malformed id, unknown/foreign ask, answered ask) still hold.
 *
 * The page is an async server component: invoke it and render the returned element. `redirect` throws
 * (as in Next) so the first matching gate short-circuits; the data seams are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getCurrentAuthContext = vi.fn();
const getAskForNarrator = vi.fn();
const getStoryForViewer = vi.fn();
const listOutstandingDrafts = vi.fn();
const listStoryRecordings = vi.fn();
// ADR-0009 Phase 3 (arrived via the master merge): the page now fetches the ask's subject photos.
// Default to none so the resume-routing assertions below are unaffected.
const listAskSubjectPhotos = vi.fn(async (..._a: unknown[]) => [] as string[]);

class RedirectError extends Error {
  constructor(public to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: {}, auth: { getCurrentAuthContext } }),
}));
vi.mock("@/lib/answer-data", () => ({
  getAskForNarrator: (...a: unknown[]) => getAskForNarrator(...a),
}));
vi.mock("@chronicle/core", () => ({
  getStoryForViewer: (...a: unknown[]) => getStoryForViewer(...a),
  listOutstandingDrafts: (...a: unknown[]) => listOutstandingDrafts(...a),
  listStoryRecordings: (...a: unknown[]) => listStoryRecordings(...a),
  listAskSubjectPhotos: (...a: unknown[]) => listAskSubjectPhotos(...a),
}));
vi.mock("../app/hub/StoryComposer", () => ({
  StoryComposer: ({ mode, ask, draft }: { mode: string; ask: unknown; draft: unknown }) => (
    <div
      data-testid="composer"
      data-mode={mode}
      data-ask={ask === null ? "null" : "present"}
      data-draft={JSON.stringify(draft)}
    />
  ),
}));

import AnswerPage from "@/app/hub/answer/[askId]/page";

const PERSON = "p-eleanor";
const ASK_ID = "11111111-bbb7-4eda-bb4f-5e645cbf2b3a";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: STORY_ID,
    ownerPersonId: PERSON,
    state: "draft",
    recordingMediaId: "m1",
    prose: "Half a story so far.",
    title: "",
    createdAt: new Date("2026-07-02T09:00:00.000Z"),
    ...overrides,
  };
}

async function run(askId = ASK_ID): Promise<string> {
  try {
    const el = await AnswerPage({ params: Promise.resolve({ askId }) });
    render(el);
    return "RENDERED";
  } catch (err) {
    if (err instanceof RedirectError) return err.to;
    throw err;
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnswerPage draft-resume (slice 9)", () => {
  it("resumes a live DRAFT answer and threads state onto the DraftInfo", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    getAskForNarrator.mockResolvedValue({
      questionText: "What was your first job?",
      askerSpokenName: "Nora",
      status: "routed",
    });
    listOutstandingDrafts.mockResolvedValue([
      { storyId: STORY_ID, askId: ASK_ID, kind: "voice", state: "draft", recordedAt: new Date("2026-07-02T09:00:00.000Z") },
    ]);
    getStoryForViewer.mockResolvedValue(story({ state: "draft" }));
    listStoryRecordings.mockResolvedValue([{ position: 0, mediaId: "m1" }]);

    expect(await run()).toBe("RENDERED");
    const composer = screen.getByTestId("composer");
    expect(composer.getAttribute("data-mode")).toBe("answer");
    const draft = JSON.parse(composer.getAttribute("data-draft") ?? "null");
    expect(draft.storyId).toBe(STORY_ID);
    expect(draft.state).toBe("draft");
    expect(draft.prose).toBe("Half a story so far.");
  });

  it("still resumes a pending_approval answer with its state threaded", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    getAskForNarrator.mockResolvedValue({
      questionText: "What was your first job?",
      askerSpokenName: "Nora",
      status: "routed",
    });
    listOutstandingDrafts.mockResolvedValue([
      { storyId: STORY_ID, askId: ASK_ID, kind: "voice", state: "pending_approval", recordedAt: new Date("2026-07-02T09:00:00.000Z") },
    ]);
    getStoryForViewer.mockResolvedValue(story({ state: "pending_approval" }));
    listStoryRecordings.mockResolvedValue([{ position: 0, mediaId: "m1" }]);

    expect(await run()).toBe("RENDERED");
    const draft = JSON.parse(screen.getByTestId("composer").getAttribute("data-draft") ?? "null");
    expect(draft.state).toBe("pending_approval");
  });

  it("renders capture (draft=null) when the ask has no outstanding draft", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    getAskForNarrator.mockResolvedValue({
      questionText: "What was your first job?",
      askerSpokenName: "Nora",
      status: "queued",
    });
    listOutstandingDrafts.mockResolvedValue([]);

    expect(await run()).toBe("RENDERED");
    const draft = JSON.parse(screen.getByTestId("composer").getAttribute("data-draft") ?? "null");
    expect(draft).toBeNull();
    expect(getStoryForViewer).not.toHaveBeenCalled();
  });

  it("redirects an already-answered ask to the Questions tab", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    getAskForNarrator.mockResolvedValue({
      questionText: "x",
      askerSpokenName: "Nora",
      status: "answered",
    });
    expect(await run()).toBe("/hub?tab=questions");
  });
});
