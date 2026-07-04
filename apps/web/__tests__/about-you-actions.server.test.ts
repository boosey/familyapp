/**
 * Server-action tests for the intake surface (ADR-0014 Inc 4, slice 2): Cleanup on the transcription
 * path and the opt-in intake Polish. Both must log the append-only `intake_revisions` provenance
 * ledger. Uses a real PGlite DB + in-memory storage; the Transcriber and LanguageModel are scripted
 * so we control the raw transcript, the cleaned text, and the polished text deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: ScriptedLanguageModel;
let runtimeTranscriber: ScriptedTranscriber;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    transcriber: runtimeTranscriber,
    dispatchPipeline: async () => {},
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  getIntakeAnswer,
  listIntakeRevisions,
  saveIntakeText,
} from "@chronicle/core";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { submitIntakeRecording, polishIntakeAnswerAction } from "@/app/hub/about-you/actions";

const HOMETOWN = "hometown";

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

function audioForm(): FormData {
  const fd = new FormData();
  fd.append("audio", new Blob(["fake-audio-bytes"], { type: "audio/webm" }));
  return fd;
}

function polishForm(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("intake actions — Cleanup + Polish provenance (ADR-0014 Inc 4, slice 2)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = new ScriptedLanguageModel({});
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    authCtx = { kind: "none" };
  });
  afterEach(() => {});

  it("submitIntakeRecording: seeds CLEANED text, keeps RAW transcript, logs ai_transcribed + ai_cleaned", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const RAW = "um, so I grew up in, uh, Metairie you know";
    const CLEANED = "I grew up in Metairie.";
    runtimeTranscriber.setScript({ text: RAW, modelId: "mock-whisper-turbo" });
    runtimeLlm.setScript({ respond: CLEANED, modelId: "mock-cleanup" });

    const result = await submitIntakeRecording(HOMETOWN, audioForm());
    expect(result).toEqual({ transcript: CLEANED });

    // Persisted row: text is the CLEANED seed; transcript holds the RAW words.
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row).not.toBeNull();
    expect(row!.text).toBe(CLEANED);
    expect(row!.transcript).toBe(RAW);

    // Ledger: exactly ai_transcribed(raw) then ai_cleaned(cleaned), in provenance order.
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs.map((r) => r.level)).toEqual(["ai_transcribed", "ai_cleaned"]);
    expect(revs[0]!.text).toBe(RAW);
    expect(revs[0]!.modelId).toBe("mock-whisper-turbo");
    expect(revs[1]!.text).toBe(CLEANED);
    expect(revs[1]!.modelId).toBe("mock-cleanup");
    expect(revs[1]!.promptText).toBeTruthy();
  });

  it("submitIntakeRecording: an empty transcript is a no-op — no seed, no revisions", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    runtimeTranscriber.setScript({ text: "   " });

    const result = await submitIntakeRecording(HOMETOWN, audioForm());
    expect(result).toEqual({ transcript: "" });

    // The ingest row exists (audio was kept) but has no cleaned seed and no revisions logged.
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row).not.toBeNull();
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs).toHaveLength(0);
  });

  it("submitIntakeRecording: a cleanup failure falls back to raw — logs ai_transcribed, skips ai_cleaned", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const RAW = "um so I grew up in Metairie";
    runtimeTranscriber.setScript({ text: RAW, modelId: "mock-whisper-turbo" });
    // The Cleanup model is down: cleanupTake throws → the action falls back to the raw transcript.
    runtimeLlm.setScript({
      respond: () => {
        throw new Error("cleanup model down");
      },
    });

    const result = await submitIntakeRecording(HOMETOWN, audioForm());
    // Never lose the words: the raw transcript seeds the editor and is persisted.
    expect(result).toEqual({ transcript: RAW });
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row!.text).toBe(RAW);
    expect(row!.transcript).toBe(RAW);

    // Provenance: ai_transcribed(raw) is logged; ai_cleaned is skipped (no pass actually ran).
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs.map((r) => r.level)).toEqual(["ai_transcribed"]);
    expect(revs[0]!.text).toBe(RAW);
  });

  it("polishIntakeAnswerAction: real polish on a saved row updates text + appends one ai_polished", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    // A saved (typed) answer exists.
    await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: "i grew up in metairie it was hot",
    });
    const before = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);

    const POLISHED = "I grew up in Metairie. It was hot.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });

    const result = await polishIntakeAnswerAction(
      polishForm({ questionKey: HOMETOWN, prose: "i grew up in metairie it was hot" }),
    );
    expect(result).toEqual({ prose: POLISHED });

    const after = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(after!.text).toBe(POLISHED);

    const revs = await listIntakeRevisions(runtimeDb, before!.id);
    const polished = revs.filter((r) => r.level === "ai_polished");
    expect(polished).toHaveLength(1);
    expect(polished[0]!.text).toBe(POLISHED);
    expect(polished[0]!.modelId).toBe("mock-polish");
  });

  it("polishIntakeAnswerAction: empty prose is a no-op — returns input, logs nothing", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: "kept",
    });
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);

    const result = await polishIntakeAnswerAction(
      polishForm({ questionKey: HOMETOWN, prose: "   " }),
    );
    expect(result).toEqual({ prose: "   " });

    // Text unchanged; no revision written.
    const after = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(after!.text).toBe("kept");
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs).toHaveLength(0);
  });

  it("polishIntakeAnswerAction: no saved row yet returns the polished text without crashing or logging", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const POLISHED = "I grew up in Metairie.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });

    const result = await polishIntakeAnswerAction(
      polishForm({ questionKey: HOMETOWN, prose: "i grew up in metairie" }),
    );
    expect(result).toEqual({ prose: POLISHED });

    // No answer row was created by the polish, so nothing was persisted or logged.
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row).toBeNull();
  });
});
