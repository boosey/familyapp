import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { renderStoryFromTranscript } from "../src/render-story";

describe("renderStoryFromTranscript", () => {
  it("returns the exact system prompt it used (for provenance)", async () => {
    const llm = new ScriptedLanguageModel();
    const out = await renderStoryFromTranscript(llm, { transcript: "I was born on a farm." });
    expect(typeof out.systemPrompt).toBe("string");
    // The prompt the model actually saw must equal what we report.
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
  });
});
