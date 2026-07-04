/**
 * Regression test for the Questions-tab per-ask dedup (ADR-0007 refactor).
 *
 * The hub now reads the general `listOutstandingDrafts` and splits it, replacing the old
 * `listOutstandingAnswerDrafts` (which kept the LATEST take per ask). A naive `Object.fromEntries`
 * over a most-recent-first list is LAST-wins → it would keep the OLDEST take, silently regressing the
 * Questions tab. `latestDraftPerAsk` locks the latest-wins contract (keep first occurrence, since
 * input is most-recent-first) and excludes self-initiated (askId === null) drafts.
 */
import { describe, expect, it } from "vitest";
import type { OutstandingDraft } from "@chronicle/core";
import { latestDraftPerAsk, questionsTabAnswerDrafts } from "@/app/hub/draft-dedup";

const draft = (over: Partial<OutstandingDraft>): OutstandingDraft => ({
  storyId: "s?",
  askId: "a?",
  kind: "voice",
  state: "pending_approval",
  recordedAt: new Date(0),
  ...over,
});

describe("latestDraftPerAsk", () => {
  it("keeps the LATEST take when two drafts share an ask (most-recent-first input)", () => {
    // Input is most-recent-first (as listOutstandingDrafts returns): the newer take comes first.
    const drafts: OutstandingDraft[] = [
      draft({ askId: "a1", storyId: "newer", recordedAt: new Date("2026-07-03T00:00:00Z") }),
      draft({ askId: "a1", storyId: "older", recordedAt: new Date("2026-07-01T00:00:00Z") }),
    ];
    const map = latestDraftPerAsk(drafts);
    expect(Object.keys(map)).toEqual(["a1"]);
    expect(map.a1!.storyId).toBe("newer");
    expect(map.a1!.recordedAt).toEqual(new Date("2026-07-03T00:00:00Z"));
  });

  it("excludes self-initiated (askId === null) drafts", () => {
    const drafts: OutstandingDraft[] = [
      draft({ askId: null, storyId: "self" }),
      draft({ askId: "a2", storyId: "answer" }),
    ];
    const map = latestDraftPerAsk(drafts);
    expect(Object.keys(map)).toEqual(["a2"]);
    expect(map.a2!.storyId).toBe("answer");
  });
});

/**
 * Guards the Questions-tab state gate. ADR-0014 widened the base read (`listOutstandingDrafts`) to
 * include the live `draft` state; without this filter an ask answer STILL being composed would leak
 * into the Questions tab (which must show only review-ready `pending_approval` answers). The hub
 * reads the raw base list and splits inline, so this pins the split's contract — the exact leak the
 * green suite did not otherwise catch.
 */
describe("questionsTabAnswerDrafts", () => {
  it("EXCLUDES an ask-backed draft still in the live 'draft' state", () => {
    const drafts: OutstandingDraft[] = [
      draft({ askId: "a1", storyId: "composing", state: "draft" }),
    ];
    expect(questionsTabAnswerDrafts(drafts)).toEqual([]);
  });

  it("INCLUDES an ask-backed draft in 'pending_approval'", () => {
    const answer = draft({ askId: "a1", storyId: "review-ready", state: "pending_approval" });
    expect(questionsTabAnswerDrafts([answer])).toEqual([answer]);
  });

  it("excludes self-initiated (askId === null) drafts regardless of state", () => {
    const drafts: OutstandingDraft[] = [
      draft({ askId: null, storyId: "self-draft", state: "draft" }),
      draft({ askId: null, storyId: "self-pending", state: "pending_approval" }),
    ];
    expect(questionsTabAnswerDrafts(drafts)).toEqual([]);
  });
});
