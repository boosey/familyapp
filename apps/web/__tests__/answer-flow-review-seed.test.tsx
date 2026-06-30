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
import { AnswerFlow, type DraftInfo } from "@/app/hub/answer/[askId]/AnswerFlow";

// AnswerFlow calls useRouter() at the top; the handlers that use it aren't exercised here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

// actions.ts is a "use server" module that pulls getRuntime()/db at import time. The review
// editor never invokes it in this test, so stub it to keep the unit test free of server wiring.
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
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
};

// Mirror page.tsx exactly: the key flips on the record→review transition (and back on re-record).
const mountKey = (d: DraftInfo | null) => d?.storyId ?? "record";

function Harness({ draft: d, keyed }: { draft: DraftInfo | null; keyed: boolean }) {
  return (
    <AnswerFlow
      key={keyed ? mountKey(d) : "static"}
      askId="11834dd1-04f4-44a4-b611-24fdd9c3d8fd"
      questionText="What have you learned about being a grandparent?"
      askerName="Sam"
      draft={d}
    />
  );
}

describe("AnswerFlow record→review editor seeding", () => {
  it("seeds the review editor with draft.prose after the keyed remount (the fix)", () => {
    // Record phase: draft is null, there is no editor yet.
    const { rerender } = render(<Harness draft={null} keyed />);
    expect(screen.queryByRole("textbox")).toBeNull();

    // router.refresh() populates the draft; the key change remounts the client component.
    rerender(<Harness draft={draft} keyed />);

    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.value).toBe(PROSE);
  });

  it("CONTROL: without the key the editor stays empty across the same transition (the bug)", () => {
    const { rerender } = render(<Harness draft={null} keyed={false} />);
    rerender(<Harness draft={draft} keyed={false} />);

    // Same component instance is reused (no remount) → proseDraft stuck at its initial "".
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.value).toBe("");
  });

  // The behavioral tests above apply the key in their own harness; this guards that page.tsx
  // actually emits it, so deleting the key (re-introducing the bug) fails CI.
  it("page.tsx mounts AnswerFlow with the remount key", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../app/hub/answer/[askId]/page.tsx"), "utf8");
    expect(src).toContain('key={draft?.storyId ?? "record"}');
  });
});
