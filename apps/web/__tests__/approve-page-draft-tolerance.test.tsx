// @vitest-environment jsdom
/**
 * Slice 2b: the approval page must tolerate a story that is still `draft` (the durable pipeline
 * hasn't finished) by rendering the "almost ready" polling view — NOT the old hard pending_approval
 * requirement (which showed the "already settled" fallback and read as "your story is gone").
 *
 *   - draft  + owner   → the ApprovePending processing view
 *   - pending_approval → the real approve UI (ApprovalRecorder)
 *   - approved/shared / not-owner / missing → unchanged "already settled" fallback
 *
 * The page is an async server component: we render the element it returns. Its client children and
 * the data seams (runtime/resolveLinkSession/getStoryForViewer) are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const resolveLinkSession = vi.fn();
const getStoryForViewer = vi.fn();

vi.mock("@/lib/runtime", () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock("@chronicle/capture", () => ({ resolveLinkSession: (...a: unknown[]) => resolveLinkSession(...a) }));
vi.mock("@chronicle/core", () => ({ getStoryForViewer: (...a: unknown[]) => getStoryForViewer(...a) }));
vi.mock("@/app/s/[token]/approve/[storyId]/ApprovalRecorder", () => ({
  ApprovalRecorder: () => <div data-testid="approve-ui">approve-ui</div>,
}));
vi.mock("@/app/s/[token]/approve/[storyId]/ApprovePending", () => ({
  ApprovePending: ({ storyId }: { storyId: string }) => (
    <div data-testid="approve-pending">pending:{storyId}</div>
  ),
}));
vi.mock("@/app/_kindred", () => ({ KindredListenBar: () => <div>listen-bar</div> }));

import ApprovePage from "@/app/s/[token]/approve/[storyId]/page";

const PERSON = "p-eleanor";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

function story(overrides: Record<string, unknown>) {
  return {
    id: STORY_ID,
    ownerPersonId: PERSON,
    state: "pending_approval",
    audienceTier: "private",
    recordingMediaId: "m1",
    prose: "Some prose.",
    ...overrides,
  };
}

async function renderPage() {
  const el = await ApprovePage({ params: Promise.resolve({ token: "tok", storyId: STORY_ID }) });
  render(el);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApprovePage draft-tolerance", () => {
  it("renders the processing view when the owner's story is still draft", async () => {
    resolveLinkSession.mockResolvedValue({ personId: PERSON });
    getStoryForViewer.mockResolvedValue(story({ state: "draft" }));
    await renderPage();
    expect(screen.getByTestId("approve-pending")).toBeTruthy();
    expect(screen.queryByTestId("approve-ui")).toBeNull();
  });

  it("renders the approve UI when the story is pending_approval", async () => {
    resolveLinkSession.mockResolvedValue({ personId: PERSON });
    getStoryForViewer.mockResolvedValue(story({ state: "pending_approval" }));
    await renderPage();
    expect(screen.getByTestId("approve-ui")).toBeTruthy();
    expect(screen.queryByTestId("approve-pending")).toBeNull();
  });

  it("shows the settled fallback for an already-shared story (no processing view)", async () => {
    resolveLinkSession.mockResolvedValue({ personId: PERSON });
    getStoryForViewer.mockResolvedValue(story({ state: "shared" }));
    await renderPage();
    expect(screen.getByText(/already settled/)).toBeTruthy();
    expect(screen.queryByTestId("approve-pending")).toBeNull();
    expect(screen.queryByTestId("approve-ui")).toBeNull();
  });

  it("does not show the processing view for a draft owned by someone else", async () => {
    resolveLinkSession.mockResolvedValue({ personId: PERSON });
    getStoryForViewer.mockResolvedValue(story({ state: "draft", ownerPersonId: "other" }));
    await renderPage();
    expect(screen.queryByTestId("approve-pending")).toBeNull();
    expect(screen.getByText(/already settled/)).toBeTruthy();
  });

  it("shows the resting fallback for an unresolved token", async () => {
    resolveLinkSession.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText(/resting for now/)).toBeTruthy();
  });
});
