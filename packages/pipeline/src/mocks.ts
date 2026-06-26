/**
 * Deterministic, dependency-free mocks of the vendor interfaces, used by the orchestrator's own
 * tests and by every downstream package's tests so no real vendor call ever happens in CI.
 *
 * - `ScriptedTranscriber` returns a transcript/word-timings the test sets up explicitly. It also
 *   records every call so tests can assert "the canonical bytes were never handed to me".
 * - `ScriptedLanguageModel` returns prose/title/summary/tags derived deterministically from the
 *   request, so the orchestrator's prompt construction is testable end-to-end.
 */
import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
  TranscribeInput,
  Transcriber,
  TranscriptionResult,
  WordTiming,
} from "./contracts";

export interface ScriptedTranscriberCall {
  bytes: Uint8Array;
  contentType: string;
}

export interface ScriptedTranscriberScript {
  text: string;
  words?: WordTiming[];
  modelId?: string;
}

/**
 * A `Transcriber` that returns whatever script the test programs in. Records every call so
 * tests can assert the canonical audio bytes never reach the transcriber (only the working
 * copy does — the LOCKED authenticity invariant).
 */
export class ScriptedTranscriber implements Transcriber {
  readonly calls: ScriptedTranscriberCall[] = [];
  constructor(private script: ScriptedTranscriberScript) {}

  setScript(script: ScriptedTranscriberScript): void {
    this.script = script;
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    this.calls.push({ bytes: input.bytes.slice(), contentType: input.contentType });
    return {
      text: this.script.text,
      words: this.script.words ?? [],
      modelId: this.script.modelId ?? "mock-whisper-turbo",
    };
  }
}

export interface ScriptedLanguageModelScript {
  /**
   * Either a string (returned verbatim as `text`) or a function of the request — useful for
   * tests that want to assert the orchestrator built the right prompt.
   */
  respond?: string | ((req: LanguageModelRequest) => string);
  modelId?: string;
}

export class ScriptedLanguageModel implements LanguageModel {
  readonly calls: LanguageModelRequest[] = [];
  constructor(private script: ScriptedLanguageModelScript = {}) {}

  setScript(script: ScriptedLanguageModelScript): void {
    this.script = script;
  }

  async complete(req: LanguageModelRequest): Promise<LanguageModelResponse> {
    this.calls.push(req);
    const r = this.script.respond;
    const text = typeof r === "function" ? r(req) : (r ?? defaultRender(req));
    return { text, modelId: this.script.modelId ?? "mock-claude" };
  }
}

function defaultRender(req: LanguageModelRequest): string {
  // A deterministic, structured default that matches the JSON shape the render-story stage
  // expects, so a test that doesn't set `respond` still flows end-to-end.
  const user = req.messages.find((m) => m.role === "user")?.content ?? "";
  const firstSentence = user.split(/[.!?]/)[0]?.trim() ?? "Untitled";
  return JSON.stringify({
    prose: user,
    title: firstSentence.slice(0, 60) || "Untitled",
    summary: firstSentence.slice(0, 140) || "",
    tags: [] as string[],
  });
}
