import { describe, expect, it } from "vitest";
import { polishProse, POLISH_SYSTEM_PROMPT } from "../src/polish-prose";
import { ScriptedLanguageModel } from "../src/mocks";

describe("polishProse", () => {
  it("no-ops on empty/whitespace input without calling the model", async () => {
    const llm = new ScriptedLanguageModel({ respond: "SHOULD NOT BE USED" });
    const out = await polishProse(llm, { prose: "   \n  " });
    expect(out.prose).toBe("   \n  ");
    expect(out.modelId).toBe(""); // no model was called
    expect(llm.calls.length).toBe(0);
  });

  it("returns the model's rewritten prose and records the model id", async () => {
    const llm = new ScriptedLanguageModel({
      respond: "He was born in 1987.",
      modelId: "mock-polish",
    });
    const out = await polishProse(llm, {
      prose: "He was born in 1985 — oh wait, no, 1987.",
    });
    expect(out.prose).toBe("He was born in 1987.");
    expect(out.modelId).toBe("mock-polish");
  });

  it("sends the in-house system prompt and the prose (never leaves prompt-building to the vendor)", async () => {
    const llm = new ScriptedLanguageModel({ respond: "tidied" });
    await polishProse(llm, { prose: "some rambling", promptQuestion: "What was your first job?" });
    const req = llm.calls[0]!;
    expect(req.messages[0]).toEqual({ role: "system", content: POLISH_SYSTEM_PROMPT });
    expect(req.messages[1]!.content).toContain("some rambling");
    expect(req.messages[1]!.content).toContain("What was your first job?");
  });

  it("strips a single symmetric wrapping quote pair the model sometimes adds", async () => {
    const llm = new ScriptedLanguageModel({ respond: '"Just the prose, please."' });
    const out = await polishProse(llm, { prose: "x" });
    expect(out.prose).toBe("Just the prose, please.");
  });

  it("leaves internal quotes untouched (only a fully-wrapping pair is stripped)", async () => {
    const llm = new ScriptedLanguageModel({ respond: 'She said "hello" and left.' });
    const out = await polishProse(llm, { prose: "x" });
    expect(out.prose).toBe('She said "hello" and left.');
  });

  it("falls back to the original prose when the model returns nothing usable (never deletes words)", async () => {
    const llm = new ScriptedLanguageModel({ respond: "   " });
    const out = await polishProse(llm, { prose: "the narrator's real words" });
    expect(out.prose).toBe("the narrator's real words");
  });
});
