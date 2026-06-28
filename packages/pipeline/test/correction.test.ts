/**
 * Tests for `applyVoiceCorrection` — the spec's "correction regenerates prose only; audio
 * untouched" path. End-to-end: gives a story to pending_approval, runs a correction, asserts
 * derived fields changed and the canonical audio bytes in storage are still byte-identical.
 */
import { createHash } from "node:crypto";
import {
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { applyVoiceCorrection, ScriptedLanguageModel } from "../src/index";

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

describe("applyVoiceCorrection", () => {
  it("regenerates prose from the corrected transcript without touching the canonical audio", async () => {
    const [narrator] = await db
      .insert(persons)
      .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1947 })
      .returning();

    const canonical = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const storageKey = `story-audio/${narrator!.id}/test.webm`;
    await storage.put({ key: storageKey, bytes: canonical, contentType: "audio/webm" });
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator!.id,
      storageKey,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum: sha(canonical),
    });
    await updateDerivedFields(db, story.id, {
      transcript: "I was born in 1948",
      prose: "I was born in 1948.",
      title: "Birth",
      summary: "Birth.",
      tags: ["birth"],
    });
    await transitionStoryState(db, story.id, "pending_approval");

    const llm = new ScriptedLanguageModel({
      respond: () =>
        JSON.stringify({
          prose: "I was born in 1947 — the corrected year.",
          title: "Birth in 1947",
          summary: "Corrected year.",
          tags: ["birth", "1947"],
        }),
    });

    const updated = await applyVoiceCorrection({
      db,
      languageModel: llm,
      storyId: story.id,
      correctedTranscript: "I was born in 1947, not 1948.",
    });

    expect(updated.transcript).toBe("I was born in 1947, not 1948.");
    expect(updated.prose).toMatch(/1947/);
    expect(updated.title).toBe("Birth in 1947");
    expect(updated.tags).toEqual(["birth", "1947"]);
    // State stays pending_approval — approval is a separate narrator voice action.
    expect(updated.state).toBe("pending_approval");
    // Audio pointer unchanged AND the canonical bytes in storage are byte-identical.
    expect(updated.recordingMediaId).toBe(story.recordingMediaId);
    expect(Array.from((await storage.getBytes(storageKey))!)).toEqual(Array.from(canonical));

    // The renderer was passed the corrected transcript (in-house prompt construction).
    expect(llm.calls.length).toBe(1);
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toMatch(/1947, not 1948/);
    // Narrator context (spokenName, birthYear) flows through.
    expect(userMsg).toMatch(/Eleanor/);
    expect(userMsg).toMatch(/1947/);
  });
});
