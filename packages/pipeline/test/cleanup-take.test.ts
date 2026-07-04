import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { cleanupTake, CLEANUP_SYSTEM_PROMPT } from "../src/cleanup-take";

describe("cleanupTake", () => {
  it("empty/whitespace transcript is a no-op: no LLM call, empty prose", async () => {
    const llm = new ScriptedLanguageModel();
    const out = await cleanupTake(llm, { transcript: "   \n  " });
    expect(llm.calls).toHaveLength(0);
    expect(out.prose).toBe("");
    expect(out.modelId).toBe("");
    expect(out.systemPrompt).toBe(CLEANUP_SYSTEM_PROMPT);
  });

  it("returns the model's cleaned text as prose, with provenance", async () => {
    const llm = new ScriptedLanguageModel({ respond: "I was born on a farm.", modelId: "mock-cleanup" });
    const out = await cleanupTake(llm, { transcript: "uh I was, I was born on a farm you know" });
    expect(llm.calls).toHaveLength(1);
    expect(out.prose).toBe("I was born on a farm.");
    expect(out.modelId).toBe("mock-cleanup");
    // Provenance: the system prompt we report is the one the model actually saw.
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
    expect(out.systemPrompt).toBe(CLEANUP_SYSTEM_PROMPT);
  });

  it("requests plain-text (not JSON) output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "clean text" });
    await cleanupTake(llm, { transcript: "some words" });
    expect(llm.calls[0]!.responseFormat).toBe("text");
  });

  it("empty model output falls back to the raw transcript — Cleanup never deletes a take", async () => {
    const llm = new ScriptedLanguageModel({ respond: "   " });
    const out = await cleanupTake(llm, { transcript: "  my exact words  " });
    expect(out.prose).toBe("my exact words");
  });

  it("includes promptQuestion and narratorSpokenName in the user message when provided", async () => {
    const llm = new ScriptedLanguageModel({ respond: "ok" });
    await cleanupTake(llm, {
      transcript: "we moved a lot",
      promptQuestion: "Where did you grow up?",
      narratorSpokenName: "Rosa",
    });
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Rosa");
    expect(userMsg).toContain("Where did you grow up?");
    expect(userMsg).toContain("we moved a lot");
  });

  it("the Cleanup prompt is distinct from the holistic Polish prompt and forbids reordering", async () => {
    // Guards the pass-scope invariant: Cleanup is single-take + order-preserving; de-ramble/reorder
    // belongs to the manual Polish. If someone pastes the Polish prompt in here, this fails.
    const { POLISH_SYSTEM_PROMPT } = await import("../src/polish-prose");
    expect(CLEANUP_SYSTEM_PROMPT).not.toBe(POLISH_SYSTEM_PROMPT);
    expect(CLEANUP_SYSTEM_PROMPT.toLowerCase()).toContain("reorder");
  });

  it("a filler-only take that yields no model output keeps its raw words (never-delete beats remove-filler)", async () => {
    // Documents the deliberate precedence: we cannot distinguish "all filler" from "model failed",
    // so a take is never silently dropped — its raw text survives rather than vanishing.
    const llm = new ScriptedLanguageModel({ respond: "" });
    const out = await cleanupTake(llm, { transcript: "um, uh, you know" });
    expect(out.prose).toBe("um, uh, you know");
  });

  it("omits the context block entirely when no name/question is supplied", async () => {
    const llm = new ScriptedLanguageModel({ respond: "ok" });
    await cleanupTake(llm, { transcript: "just the words" });
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).not.toContain("Speaker's spoken name");
    expect(userMsg).not.toContain("Question that prompted");
  });
});
