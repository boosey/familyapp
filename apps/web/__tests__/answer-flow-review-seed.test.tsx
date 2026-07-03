// @vitest-environment jsdom
/**
 * Regression test for the empty review-field bug.
 *
 * Bug: after recording, the in-hub answer flow transitions record → review via
 * router.refresh(), which updates the server props (draft.prose is now populated) but does
 * NOT remount the client AnswerFlow. AnswerFlow seeds `proseDraft` from `draft?.prose` only at
 * mount — when draft was still null — so the review editor rendered empty even though the prose
 * was persisted.
 *
 * Fix: page.tsx mounts AnswerFlow with `key={draft?.storyId ?? "record"}`, so the transition
 * remounts the component and re-seeds proseDraft from the now-populated prop.
 *
 * This test exercises that transition both ways:
 *  - keyed (the real page.tsx behavior) → editor shows the prose  [guards the fix]
 *  - unkeyed (the original bug)         → editor stays empty       [proves the test has teeth]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryComposer, type DraftInfo } from "@/app/hub/StoryComposer";
import { AnswerReviewPending } from "@/app/hub/answer/[askId]/AnswerReviewPending";

// StoryComposer calls useRouter() at the top; the handlers that use it aren't exercised here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

// actions.ts is a "use server" module that pulls getRuntime()/db at import time. The review
// editor never invokes it in this test, so stub it to keep the unit test free of server wiring.
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: vi.fn(),
  recordAnswerAction: vi.fn(),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
}));

afterEach(cleanup);

const PROSE = "I wish I'd known how great grandchildren were going to be. I can't wait for our next.";

const draft: DraftInfo = {
  storyId: "57357613-bbb7-4eda-bb4f-5e645cbf2b3a",
  recordedAt: new Date(0).toISOString(),
  mediaUrl: "/api/media/m1",
  prose: PROSE,
  title: "A grandparent's wish",
  // Thread-of-one: exactly the initial take → the single-take review path.
  takes: [{ position: 0, mediaUrl: "/api/media/m1", isInitial: true }],
};

// Mirror page.tsx exactly: the key flips on the record→review transition (and back on re-record).
const mountKey = (d: DraftInfo | null) => d?.storyId ?? "record";

// The review phase now has TWO textboxes (the title input + the prose editor); target the prose
// editor by its stable aria-label so the seeding assertion stays unambiguous.
const proseEditor = () =>
  screen.getByRole("textbox", { name: /your story, in your words/i }) as HTMLTextAreaElement;

function Harness({ draft: d, keyed }: { draft: DraftInfo | null; keyed: boolean }) {
  return (
    <StoryComposer
      key={keyed ? mountKey(d) : "static"}
      mode="answer"
      ask={{
        id: "11834dd1-04f4-44a4-b611-24fdd9c3d8fd",
        questionText: "What have you learned about being a grandparent?",
        askerName: "Sam",
      }}
      draft={d}
    />
  );
}

describe("StoryComposer record→review editor seeding", () => {
  it("seeds the review editor with draft.prose after the keyed remount (the fix)", () => {
    // Record phase: draft is null, there is no prose editor yet.
    const { rerender } = render(<Harness draft={null} keyed />);
    expect(screen.queryByRole("textbox", { name: /your story, in your words/i })).toBeNull();

    // router.refresh() populates the draft; the key change remounts the client component.
    rerender(<Harness draft={draft} keyed />);

    expect(proseEditor().value).toBe(PROSE);
  });

  it("CONTROL: without the key the editor stays empty across the same transition (the bug)", () => {
    const { rerender } = render(<Harness draft={null} keyed={false} />);
    rerender(<Harness draft={draft} keyed={false} />);

    // Same component instance is reused (no remount) → proseDraft stuck at its initial "".
    expect(proseEditor().value).toBe("");
  });

  // The behavioral tests above apply the key in their own harness; this guards that page.tsx
  // actually emits it, so deleting the key (re-introducing the bug) fails CI.
  it("page.tsx mounts AnswerFlow with the remount key", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../app/hub/answer/[askId]/page.tsx"), "utf8");
    expect(src).toContain('key={draft?.storyId ?? "record"}');
  });
});

describe("AnswerReviewPending presentation", () => {
  it("shows audio + the polishing spinner/message, and NO editor", () => {
    const { container } = render(
      <AnswerReviewPending
        audioUrl="blob:fake-take"
        error={null}
        onRecordAgain={() => {}}
        header={<div>header</div>}
      />,
    );
    // Editor is hidden until prose is ready.
    expect(screen.queryByRole("textbox")).toBeNull();
    // Polishing status is announced and the spinner is present.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/Polishing your words/)).toBeTruthy();
    expect(container.querySelector(".kindred-spinner")).not.toBeNull();
    // The recording is replayable (one <audio> with the local URL).
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("blob:fake-take");
  });

  it("shows an error + 'Record again' button (no spinner) when render failed", () => {
    const onRecordAgain = vi.fn();
    const { container } = render(
      <AnswerReviewPending
        audioUrl="blob:fake-take"
        error="Could not save your recording. Please try again."
        onRecordAgain={onRecordAgain}
        header={<div>header</div>}
      />,
    );
    expect(container.querySelector(".kindred-spinner")).toBeNull();
    expect(screen.getByText(/Could not save your recording/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Record again/ });
    btn.click();
    expect(onRecordAgain).toHaveBeenCalledOnce();
  });
});
