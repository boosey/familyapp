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
  appendIntakeRevision,
  getIntakeAnswer,
  listIntakeRevisions,
  saveIntakeText,
} from "@chronicle/core";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import {
  submitIntakeRecording,
  polishIntakeAnswerAction,
  saveIntakeAnswer,
} from "@/app/hub/about-you/actions";

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

  it("polishIntakeAnswerAction: polishing a not-yet-saved typed answer creates the row and logs user_authored + ai_polished", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const RAW = "i grew up in metairie";
    const POLISHED = "I grew up in Metairie.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });

    const result = await polishIntakeAnswerAction(polishForm({ questionKey: HOMETOWN, prose: RAW }));
    expect(result).toEqual({ prose: POLISHED });

    // The row is created lazily by the polish, and the ledger records the TYPED input (user_authored)
    // BEFORE the polish (ai_polished) — so pure LLM output is never later mislabeled as hand-authored.
    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row).not.toBeNull();
    expect(row!.text).toBe(POLISHED);
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs.map((r) => r.level)).toEqual(["user_authored", "ai_polished"]);
    expect(revs[0]!.text).toBe(RAW);
    expect(revs[1]!.text).toBe(POLISHED);
  });

  it("polishIntakeAnswerAction: editing a voice-cleaned answer THEN polishing logs the edit as human_corrected before ai_polished", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    // A voice answer that was transcribed + cleaned (row exists, ledger has two AI passes).
    const saved = await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: "I grew up in Metairie.",
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_transcribed",
      text: "um so I grew up in Metairie",
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_cleaned",
      text: "I grew up in Metairie.",
    });

    // The narrator EDITS the cleaned text in the editor, then taps ✨Polish (prose = the edited text).
    const EDITED = "I grew up in Metairie, Louisiana.";
    const POLISHED = "I grew up in Metairie, Louisiana — a suburb of New Orleans.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });

    await polishIntakeAnswerAction(polishForm({ questionKey: HOMETOWN, prose: EDITED }));

    // The edit must NOT be dropped: it is logged as human_corrected BEFORE the ai_polished output.
    const revs = await listIntakeRevisions(runtimeDb, saved.id);
    expect(revs.map((r) => r.level)).toEqual([
      "ai_transcribed",
      "ai_cleaned",
      "human_corrected",
      "ai_polished",
    ]);
    expect(revs[2]!.text).toBe(EDITED);
    expect(revs[2]!.actorPersonId).toBe(personId);
    expect(revs[3]!.text).toBe(POLISHED);
  });

  it("polishIntakeAnswerAction: polishing an UNEDITED voice-cleaned answer adds only ai_polished (no spurious correction)", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const CLEANED = "I grew up in Metairie.";
    const saved = await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: CLEANED,
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_transcribed",
      text: "um so I grew up in Metairie",
    });
    await appendIntakeRevision(runtimeDb, { intakeAnswerId: saved.id, level: "ai_cleaned", text: CLEANED });

    // Tap ✨Polish WITHOUT editing — prose is byte-identical to the last (ai_cleaned) revision.
    const POLISHED = "I grew up in Metairie, a New Orleans suburb.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });
    await polishIntakeAnswerAction(polishForm({ questionKey: HOMETOWN, prose: CLEANED }));

    // No spurious user_authored/human_corrected row for the unedited input — only ai_polished is added.
    const revs = await listIntakeRevisions(runtimeDb, saved.id);
    expect(revs.map((r) => r.level)).toEqual(["ai_transcribed", "ai_cleaned", "ai_polished"]);
    expect(revs[2]!.text).toBe(POLISHED);
  });

  it("provenance regression: type → Polish → accept verbatim → Next never mislabels LLM output as user_authored", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const RAW = "i grew up in metairie it was hot";
    const POLISHED = "I grew up in Metairie. It was hot.";
    runtimeLlm.setScript({ respond: POLISHED, modelId: "mock-polish" });

    // Type raw text, tap ✨Polish before ever saving (no row yet), then accept the polish verbatim.
    await polishIntakeAnswerAction(polishForm({ questionKey: HOMETOWN, prose: RAW }));
    // Tap Next with the accepted-verbatim polished text.
    await saveIntakeAnswer([], HOMETOWN, POLISHED);

    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    // The ledger is [user_authored(raw), ai_polished(polished)]; the verbatim Save adds NOTHING (text
    // equals the last revision). Crucially, the polished text is labeled ai_polished, never user_authored.
    expect(revs.map((r) => r.level)).toEqual(["user_authored", "ai_polished"]);
    const polishedRev = revs.find((r) => r.text === POLISHED);
    expect(polishedRev!.level).toBe("ai_polished");
    expect(revs.some((r) => r.level === "user_authored" && r.text === POLISHED)).toBe(false);
  });

  it("saveIntakeAnswer: a pure typed answer (no prior revisions) logs exactly one user_authored", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    await saveIntakeAnswer([], HOMETOWN, "New Orleans");

    const row = await getIntakeAnswer(runtimeDb, personId, HOMETOWN);
    expect(row).not.toBeNull();
    const revs = await listIntakeRevisions(runtimeDb, row!.id);
    expect(revs.map((r) => r.level)).toEqual(["user_authored"]);
    expect(revs[0]!.text).toBe("New Orleans");
    expect(revs[0]!.actorPersonId).toBe(personId);
  });

  it("saveIntakeAnswer: an edit after a voice answer (prior AI passes) logs one human_corrected", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    // Stand in a voice answer that was already transcribed + cleaned.
    const saved = await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: "I grew up in Metairie.",
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_transcribed",
      text: "um so I grew up in Metairie",
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_cleaned",
      text: "I grew up in Metairie.",
    });

    // The narrator edits the cleaned text, then Saves.
    await saveIntakeAnswer([], HOMETOWN, "I grew up in Metairie, Louisiana.");

    const revs = await listIntakeRevisions(runtimeDb, saved.id);
    const corrections = revs.filter((r) => r.level === "human_corrected");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.text).toBe("I grew up in Metairie, Louisiana.");
    expect(corrections[0]!.actorPersonId).toBe(personId);
    // It is the newest revision.
    expect(revs[revs.length - 1]!.level).toBe("human_corrected");
  });

  it("saveIntakeAnswer: text identical to the last revision logs nothing (accepted the AI pass verbatim)", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const saved = await saveIntakeText(runtimeDb, {
      personId,
      questionKey: HOMETOWN,
      promptQuestion: "Where did you grow up?",
      text: "I grew up in Metairie.",
    });
    await appendIntakeRevision(runtimeDb, {
      intakeAnswerId: saved.id,
      level: "ai_cleaned",
      text: "I grew up in Metairie.",
    });

    // Save the same text the last revision already holds → no new revision.
    await saveIntakeAnswer([], HOMETOWN, "I grew up in Metairie.");

    const revs = await listIntakeRevisions(runtimeDb, saved.id);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.level).toBe("ai_cleaned");
  });
});
