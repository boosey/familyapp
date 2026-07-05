// @vitest-environment jsdom
/**
 * Task 10: the /hub/tell/[storyId] resume page must only reopen the narrator's OWN draft that is
 * still in review, and must bounce every other case warmly back to the Stories tab:
 *
 *   - anonymous               → redirect("/")
 *   - onboarding owed         → redirect(dest) from resolvePostAuthRoute
 *   - malformed storyId       → redirect("/hub?tab=stories")   (uuid guard, no DB parse 500)
 *   - not found               → redirect("/hub?tab=stories")   (getStoryForViewer → null)
 *   - not owned               → redirect("/hub?tab=stories")   (another person's readable story)
 *   - wrong state             → redirect("/hub?tab=stories")   (own story past review)
 *   - own draft               → renders StoryComposer seeded with the draft (ADR-0014 Inc 3 slice 9)
 *   - own pending_approval    → renders StoryComposer seeded with the draft (review phase)
 *
 * The page is an async server component: we invoke it and render the element it returns. `redirect`
 * throws (as it does in Next) so the first matching gate short-circuits; the data seams are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getCurrentAuthContext = vi.fn();
const resolvePostAuthRoute = vi.fn();
const getStoryForViewer = vi.fn();
const listStoryRecordings = vi.fn();

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
vi.mock("@/lib/post-auth-route", () => ({
  resolvePostAuthRoute: (...a: unknown[]) => resolvePostAuthRoute(...a),
}));
vi.mock("@chronicle/core", () => ({
  getStoryForViewer: (...a: unknown[]) => getStoryForViewer(...a),
  listStoryRecordings: (...a: unknown[]) => listStoryRecordings(...a),
  // Task 4: the resume page loads the author's active families for the share-step picker. Default none.
  listActiveFamiliesForPerson: async () => [],
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

import TellResumePage from "@/app/hub/tell/[storyId]/page";

const PERSON = "p-eleanor";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: STORY_ID,
    ownerPersonId: PERSON,
    state: "pending_approval",
    recordingMediaId: null,
    prose: "Some prose.",
    title: "A Title",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    ...overrides,
  };
}

async function run(storyId = STORY_ID): Promise<string> {
  try {
    const el = await TellResumePage({ params: Promise.resolve({ storyId }) });
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

describe("TellResumePage gate", () => {
  it("redirects an anonymous visitor to the landing", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "anonymous" });
    expect(await run()).toBe("/");
  });

  it("redirects to the owed onboarding step when not fully onboarded", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/welcome");
    expect(await run()).toBe("/welcome");
  });

  it("redirects a malformed storyId to the Stories tab (no DB read)", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    expect(await run("not-a-uuid")).toBe("/hub?tab=stories");
    expect(getStoryForViewer).not.toHaveBeenCalled();
  });

  it("redirects when the draft is not found", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(null);
    expect(await run()).toBe("/hub?tab=stories");
  });

  it("redirects when the story is owned by someone else", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(story({ ownerPersonId: "other", state: "shared" }));
    expect(await run()).toBe("/hub?tab=stories");
  });

  it("redirects when the owner's story is past review", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(story({ state: "shared" }));
    expect(await run()).toBe("/hub?tab=stories");
  });

  it("renders the composer for the owner's own text draft (no audio, no takes)", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(story());
    expect(await run()).toBe("RENDERED");

    const composer = screen.getByTestId("composer");
    expect(composer.getAttribute("data-mode")).toBe("tell");
    expect(composer.getAttribute("data-ask")).toBe("null");
    const draft = JSON.parse(composer.getAttribute("data-draft") ?? "null");
    expect(draft).toMatchObject({
      storyId: STORY_ID,
      mediaUrl: "",
      prose: "Some prose.",
      title: "A Title",
      state: "pending_approval",
      takes: [],
    });
    expect(draft.recordedAt).toBe("2026-07-01T12:00:00.000Z");
    expect(listStoryRecordings).not.toHaveBeenCalled();
  });

  it("renders the composer for the owner's own live DRAFT (ADR-0014 Inc 3 slice 9)", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(story({ state: "draft" }));
    expect(await run()).toBe("RENDERED");

    const draft = JSON.parse(screen.getByTestId("composer").getAttribute("data-draft") ?? "null");
    // The live-composing `draft` state is now reachable AND threaded onto DraftInfo so Slice 10's
    // phase collapse can key off it. Until then it renders via the existing review markup.
    expect(draft.state).toBe("draft");
    expect(draft.storyId).toBe(STORY_ID);
  });

  it("populates audio + takes for a voice draft resuming", async () => {
    getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
    resolvePostAuthRoute.mockResolvedValue("/hub");
    getStoryForViewer.mockResolvedValue(story({ recordingMediaId: "m1" }));
    listStoryRecordings.mockResolvedValue([
      { position: 0, mediaId: "m1" },
      { position: 1, mediaId: "m2" },
    ]);
    expect(await run()).toBe("RENDERED");

    const draft = JSON.parse(screen.getByTestId("composer").getAttribute("data-draft") ?? "null");
    expect(draft.mediaUrl).toBe("/api/media/m1");
    expect(draft.takes).toEqual([
      { position: 0, mediaUrl: "/api/media/m1", isInitial: true },
      { position: 1, mediaUrl: "/api/media/m2", isInitial: false },
    ]);
  });
});
