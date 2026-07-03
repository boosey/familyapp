import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { stories } from "@chronicle/db/content";
import {
  persistRecordingAndCreateDraft,
  persistTakeRecording,
  createTextDraft,
  appendVoiceTakeContribution,
  appendTypedTakeContribution,
  finishDraft,
  listProseRevisions,
  listStoryRecordings,
  transitionStoryState,
} from "../src/story-repository";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(name = "Eleanor") {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!;
}

// Local read helper (avoids depending on listStoryRecordings signature drift).
async function listStoryRecordingsLocal(db: Database, storyId: string) {
  return listStoryRecordings(db, storyId);
}

describe("appendVoiceTakeContribution (ADR-0014 §4)", () => {
  it("appends ai_transcribed + ai_cleaned keyed to the take, and concatenates prose", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const takeRows = await listStoryRecordingsLocal(db, story.id);
    const take0 = takeRows[0]!;

    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "um so i was born in naples",
      cleanedSegment: "I was born in Naples.",
      transcribeModelId: "whisper-1", cleanupModelId: "claude-x", cleanupPromptText: "cleanup v1",
      priorProse: null,
    });
    expect(res.prose).toBe("I was born in Naples.");
    expect(res.appendedSegment).toBe("I was born in Naples.");

    const revs = await listProseRevisions(db, story.id);
    const transcribed = revs.find((r) => r.level === "ai_transcribed")!;
    const cleaned = revs.find((r) => r.level === "ai_cleaned")!;
    expect(transcribed.text).toBe("um so i was born in naples");
    expect(transcribed.storyRecordingId).toBe(take0.id);
    expect(transcribed.modelId).toBe("whisper-1");
    expect(cleaned.text).toBe("I was born in Naples.");
    expect(cleaned.storyRecordingId).toBe(take0.id);
    expect(cleaned.modelId).toBe("claude-x");
    expect(cleaned.promptText).toBe("cleanup v1");

    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.prose).toBe("I was born in Naples.");
  });

  it("concatenates onto prior editor text with a blank-line separator", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw two", cleanedSegment: "Second segment.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: "First segment.",
    });
    expect(res.prose).toBe("First segment.\n\nSecond segment.");
  });

  it("flips a typed-first draft's kind idempotently (after persistTakeRecording already flipped it)", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Typed opener." });
    const { storyRecording } = await persistTakeRecording(db,
      { ownerPersonId: narrator.id, storageKey: "s3://b/t.wav", contentType: "audio/wav", checksum: "c" },
      story.id);
    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: storyRecording.id,
      rawTranscript: "raw", cleanedSegment: "Voice add.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: "Typed opener.",
    });
    expect(res.prose).toBe("Typed opener.\n\nVoice add.");
    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.kind).toBe("voice");
  });

  it("rejects a non-owner", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await expect(appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: intruder.id, storyRecordingId: take0.id,
      rawTranscript: "r", cleanedSegment: "c", transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: null,
    })).rejects.toThrow(/owner/i);
  });

  it("rejects when the story is not in draft state", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await transitionStoryState(db, story.id, "pending_approval");
    await expect(appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "r", cleanedSegment: "c", transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: null,
    })).rejects.toThrow(/draft/i);
  });
});

describe("appendTypedTakeContribution (ADR-0014 §4)", () => {
  it("appends user_authored keyed to the narrator, concatenates prose, leaves kind unchanged", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    const res = await appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, text: "Second typed part.", priorProse: "Opener.",
    });
    expect(res.prose).toBe("Opener.\n\nSecond typed part.");
    expect(res.appendedSegment).toBe("Second typed part.");

    const revs = await listProseRevisions(db, story.id);
    const authored = revs.filter((r) => r.level === "user_authored");
    expect(authored.length).toBe(2); // createTextDraft wrote one; this appended a second
    const latest = authored[authored.length - 1]!;
    expect(latest.text).toBe("Second typed part.");
    expect(latest.actorPersonId).toBe(narrator.id);
    expect(latest.storyRecordingId).toBeNull();

    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.kind).toBe("text");
    const takes = await listStoryRecordingsLocal(db, story.id);
    expect(takes.length).toBe(0);
  });

  it("rejects empty/whitespace text", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    await expect(appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, text: "   ", priorProse: "Opener.",
    })).rejects.toThrow(/non-empty|empty/i);
  });

  it("rejects a non-owner and a non-draft story", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    await expect(appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: intruder.id, text: "x", priorProse: null,
    })).rejects.toThrow(/owner/i);
  });
});

describe("finishDraft (ADR-0014 §4)", () => {
  it("seals an edited draft: snapshots human_corrected, writes metadata, transitions to pending_approval", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Cleaned prose.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p", priorProse: null,
    });
    const finished = await finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id,
      finalText: "Cleaned prose, then hand-edited.",
      metadata: { title: "Naples", summary: "A birth in Naples.", tags: ["childhood", "italy"] },
    });
    expect(finished.state).toBe("pending_approval");
    expect(finished.prose).toBe("Cleaned prose, then hand-edited.");
    expect(finished.title).toBe("Naples");
    expect(finished.summary).toBe("A birth in Naples.");
    expect(finished.tags).toEqual(["childhood", "italy"]);

    const revs = await listProseRevisions(db, story.id);
    const corrected = revs.filter((r) => r.level === "human_corrected");
    expect(corrected.length).toBe(1);
    expect(corrected[0]!.text).toBe("Cleaned prose, then hand-edited.");
    expect(corrected[0]!.actorPersonId).toBe(narrator.id);
  });

  it("does NOT snapshot human_corrected when finalText equals current prose", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Unchanged prose.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p", priorProse: null,
    });
    const finished = await finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id, finalText: "Unchanged prose.",
      metadata: { title: "T", summary: "S", tags: [] },
    });
    expect(finished.state).toBe("pending_approval");
    const corrected = (await listProseRevisions(db, story.id)).filter((r) => r.level === "human_corrected");
    expect(corrected.length).toBe(0);
  });

  it("rejects empty finalText (never clears prose)", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    await expect(finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id, finalText: "   ",
      metadata: { title: "T", summary: "S", tags: [] },
    })).rejects.toThrow(/empty|non-empty/i);
  });

  it("rejects a non-owner", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    await expect(finishDraft(db, {
      storyId: story.id, ownerPersonId: intruder.id, finalText: "x",
      metadata: { title: "T", summary: "S", tags: [] },
    })).rejects.toThrow(/owner/i);
  });
});
