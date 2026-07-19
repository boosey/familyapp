// @vitest-environment jsdom
/**
 * QuestionsTab (issue #208) — asserts the to-answer inbox cards render their CSS-module classes and
 * carry the Playful decorative signature, AND that QuestionsTab.module.css declares both the
 * data-skin="playful" signature block and the reduce-motion / solemn suppression block. Mirrors
 * StoryCard.test.tsx; the CSS-file assertions follow the contrast.test.ts pattern of reading the
 * stylesheet source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PendingAskForNarrator, OutstandingAnswerDraft } from "@chronicle/core";
import { QuestionsTab } from "./QuestionsTab";
import styles from "./QuestionsTab.module.css";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "QuestionsTab.module.css"), "utf8");

function makeAsk(id: string): PendingAskForNarrator {
  return {
    ask: {
      id,
      questionText: `Tell me about the boat #${id}`,
      status: "routed",
      storyId: null,
    },
    askerSpokenName: "Rosa",
  } as unknown as PendingAskForNarrator;
}

afterEach(cleanup);

describe("QuestionsTab — playful signature", () => {
  it("renders each ask as a card with the module card + question + action classes", () => {
    render(<QuestionsTab asks={[makeAsk("a1")]} draftsByAskId={{}} />);
    const question = screen.getByText("Tell me about the boat #a1");
    expect(question.className).toContain(styles.question);
    const card = question.closest("li")!;
    expect(card.className).toContain(styles.card);
    expect(screen.getByText("Answer").className).toContain(styles.action);
  });

  it("sets an inline --tilt custom property (parity-driven, math in TS)", () => {
    const { container } = render(
      <QuestionsTab asks={[makeAsk("a1"), makeAsk("a2")]} draftsByAskId={{}} />,
    );
    const cards = container.querySelectorAll("li");
    expect((cards[0] as HTMLElement).style.getPropertyValue("--tilt")).toBe("0.55deg");
    expect((cards[1] as HTMLElement).style.getPropertyValue("--tilt")).toBe("-0.55deg");
  });

  it("stickerizes the recorded-at sub-label on a draft card", () => {
    const drafts: Record<string, Pick<OutstandingAnswerDraft, "storyId" | "recordedAt">> = {
      a1: { storyId: "s1", recordedAt: new Date(Date.now() - 3600_000) },
    };
    render(<QuestionsTab asks={[makeAsk("a1")]} draftsByAskId={drafts} />);
    // The draft state shows Review & approve and a recorded sub-label carrying the .recorded class.
    expect(screen.getByText("Review & approve").className).toContain(styles.actionDraft);
    const recorded = document.querySelector(`.${styles.recorded}`);
    expect(recorded).toBeTruthy();
  });

  it("renders the empty ('caught up') card with the module empty class", () => {
    const { container } = render(<QuestionsTab asks={[]} draftsByAskId={{}} />);
    expect(container.querySelector(`.${styles.empty}`)).toBeTruthy();
  });

  it("QuestionsTab.module.css declares the playful signature block", () => {
    expect(css).toContain(':global(:root[data-skin="playful"])');
    expect(css).toMatch(/rotate\(var\(--tilt/);
    expect(css).toContain("var(--tape-bg)");
    expect(css).toContain("var(--highlighter)");
    expect(css).toContain("var(--shadow-lift)");
  });

  it("QuestionsTab.module.css declares the reduce-motion + solemn suppression block", () => {
    expect(css).toContain(':global(:root[data-reduce-motion="on"])');
    expect(css).toContain(':global([data-tone="solemn"])');
    expect(css).toMatch(/transform:\s*none/);
    expect(css).toMatch(/background-image:\s*none/);
  });
});
