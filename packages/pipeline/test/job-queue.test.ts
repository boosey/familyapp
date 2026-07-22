import { describe, expect, it } from "vitest";
import { jobDedupeKey } from "../src/contracts";
import { InProcessJobQueue } from "../src/job-queue";

describe("jobDedupeKey — per-name namespace + discrimination contract", () => {
  it("separates namespaces even when the id strings match", () => {
    // A name-blind implementation that only reads an id off the payload would collapse these.
    expect(jobDedupeKey("invite.send", { invitationId: "x", channels: ["email"] })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "x" }),
    );
  });

  it("invite jobs: same invitationId → same key, different → different", () => {
    const a1 = jobDedupeKey("invite.send", { invitationId: "inv-1", channels: ["email"] });
    // Same invitationId, DIFFERENT channels — the key must ignore everything but invitationId.
    const a2 = jobDedupeKey("invite.send", { invitationId: "inv-1", channels: ["sms"] });
    const b = jobDedupeKey("invite.send", { invitationId: "inv-2", channels: ["email"] });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("story jobs discriminate on storyId", () => {
    expect(jobDedupeKey("transcribe", { storyId: "a" })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "b" }),
    );
  });

  it("story jobs discriminate on name (same storyId, different stage)", () => {
    // A same-id-collapsing key would wrongly return the same key here.
    expect(jobDedupeKey("transcribe", { storyId: "a" })).not.toBe(
      jobDedupeKey("render_story", { storyId: "a" }),
    );
  });

  it("attempt participates in the key (retry-generation dedupe-bust)", () => {
    expect(jobDedupeKey("transcribe", { storyId: "a", attempt: 1 })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "a" }),
    );
    expect(jobDedupeKey("transcribe", { storyId: "a", attempt: 1 })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "a", attempt: 2 }),
    );
  });

  it("story.shared.notify jobs key on storyId", () => {
    expect(jobDedupeKey("story.shared.notify", { storyId: "s1" })).toBe(
      "story.shared.notify|s1",
    );
    expect(jobDedupeKey("story.shared.notify", { storyId: "s1" })).not.toBe(
      jobDedupeKey("story.shared.notify", { storyId: "s2" }),
    );
    // Distinct namespace from pipeline stages even when storyId matches.
    expect(jobDedupeKey("story.shared.notify", { storyId: "x" })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "x" }),
    );
  });

  it("ask.actionable.notify jobs key on askId", () => {
    expect(jobDedupeKey("ask.actionable.notify", { askId: "a1" })).toBe(
      "ask.actionable.notify|a1",
    );
    expect(jobDedupeKey("ask.actionable.notify", { askId: "a1" })).not.toBe(
      jobDedupeKey("ask.actionable.notify", { askId: "a2" }),
    );
    // Distinct namespace from other job names even when the id string matches.
    expect(jobDedupeKey("ask.actionable.notify", { askId: "x" })).not.toBe(
      jobDedupeKey("story.shared.notify", { storyId: "x" }),
    );
    expect(jobDedupeKey("ask.actionable.notify", { askId: "x" })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "x" }),
    );
  });
});

describe("InProcessJobQueue invite jobs", () => {
  it("dedupes invite.send by invitationId while pending", async () => {
    const q = new InProcessJobQueue();
    const id1 = await q.enqueue("invite.send", { invitationId: "inv-1", channels: ["email"] });
    const id2 = await q.enqueue("invite.send", { invitationId: "inv-1", channels: ["email"] });
    expect(id1).toBe(id2);
    expect(q.pending()).toHaveLength(1);
  });

  it("keeps invite and story jobs in separate dedupe namespaces", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "s-1" });
    await q.enqueue("invite.send", { invitationId: "s-1", channels: ["sms"] });
    expect(q.pending()).toHaveLength(2);
  });

  it("keeps two different story stages for the same storyId separate (name-blind key would collapse)", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "a" });
    await q.enqueue("render_story", { storyId: "a" });
    expect(q.pending()).toHaveLength(2);
  });

  it("keeps story.shared.notify in its own dedupe namespace from pipeline stages", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "a" });
    await q.enqueue("story.shared.notify", { storyId: "a" });
    expect(q.pending()).toHaveLength(2);
  });

  it("dedupes ask.actionable.notify by askId while pending", async () => {
    const q = new InProcessJobQueue();
    const id1 = await q.enqueue("ask.actionable.notify", { askId: "ask-1" });
    const id2 = await q.enqueue("ask.actionable.notify", { askId: "ask-1" });
    expect(id1).toBe(id2);
    expect(q.pending()).toHaveLength(1);
  });

  it("keeps ask.actionable.notify in its own dedupe namespace from pipeline stages", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "a" });
    await q.enqueue("ask.actionable.notify", { askId: "a" });
    expect(q.pending()).toHaveLength(2);
  });
});
