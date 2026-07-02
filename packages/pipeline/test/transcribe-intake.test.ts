import { describe, expect, it } from "vitest";
import type { Transcriber, TranscribeInput, TranscriptionResult } from "../src/contracts";
import { transcribeIntakeAudio } from "../src/transcribe-intake";

class StubTranscriber implements Transcriber {
  lastInput: TranscribeInput | null = null;
  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    this.lastInput = input;
    return { text: "grew up in Metairie", words: [], modelId: "stub-1" };
  }
}

describe("transcribeIntakeAudio", () => {
  it("passes the raw bytes to the transcriber and returns text + modelId", async () => {
    const t = new StubTranscriber();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await transcribeIntakeAudio(t, { bytes, contentType: "audio/webm" });
    expect(result).toEqual({ text: "grew up in Metairie", modelId: "stub-1" });
    expect(t.lastInput).toEqual({ bytes, contentType: "audio/webm" });
  });
});
