import { describe, expect, it } from "vitest";
import { jobDedupeKey } from "../src/contracts";
import { InProcessJobQueue } from "../src/job-queue";

describe("jobDedupeKey — per-name namespace + discrimination contract", () => {
  it("separates namespaces even when the id strings match", () => {
    // A name-blind implementation that only reads an id off the payload would collapse these.
    expect(jobDedupeKey("invite.send", { invitationId: "x", sealedToken: "t", channels: ["email"] })).not.toBe(
      jobDedupeKey("transcribe", { storyId: "x" }),
    );
  });

  it("invite jobs: same invitationId → same key, different → different", () => {
    const a1 = jobDedupeKey("invite.send", { invitationId: "inv-1", sealedToken: "t", channels: ["email"] });
    // Same invitationId, DIFFERENT sealedToken/channels — the key must ignore everything but invitationId.
    const a2 = jobDedupeKey("invite.send", { invitationId: "inv-1", sealedToken: "other", channels: ["sms"] });
    const b = jobDedupeKey("invite.send", { invitationId: "inv-2", sealedToken: "t", channels: ["email"] });
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
});

describe("InProcessJobQueue invite jobs", () => {
  it("dedupes invite.send by invitationId while pending", async () => {
    const q = new InProcessJobQueue();
    const id1 = await q.enqueue("invite.send", { invitationId: "inv-1", sealedToken: "t", channels: ["email"] });
    const id2 = await q.enqueue("invite.send", { invitationId: "inv-1", sealedToken: "t", channels: ["email"] });
    expect(id1).toBe(id2);
    expect(q.pending()).toHaveLength(1);
  });

  it("keeps invite and story jobs in separate dedupe namespaces", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "s-1" });
    await q.enqueue("invite.send", { invitationId: "s-1", sealedToken: "t", channels: ["sms"] });
    expect(q.pending()).toHaveLength(2);
  });

  it("keeps two different story stages for the same storyId separate (name-blind key would collapse)", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "a" });
    await q.enqueue("render_story", { storyId: "a" });
    expect(q.pending()).toHaveLength(2);
  });
});
