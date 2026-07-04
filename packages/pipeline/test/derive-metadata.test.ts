import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { deriveMetadata, METADATA_SYSTEM_PROMPT } from "../src/derive-metadata";

describe("deriveMetadata", () => {
  it("returns title/summary/tags from a JSON response, with provenance", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({
        title: "The Farm",
        summary: "How I grew up on a dairy farm.",
        tags: ["farm", "childhood"],
      }),
      modelId: "mock-meta",
    });
    const out = await deriveMetadata(llm, { fullText: "I grew up on a dairy farm in Ohio." });
    expect(out.title).toBe("The Farm");
    expect(out.summary).toBe("How I grew up on a dairy farm.");
    expect(out.tags).toEqual(["farm", "childhood"]);
    expect(out.modelId).toBe("mock-meta");
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
    expect(out.systemPrompt).toBe(METADATA_SYSTEM_PROMPT);
  });

  it("does not derive prose or era (title/summary/tags only)", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: "T", summary: "S", tags: [], prose: "SHOULD BE IGNORED", eraYear: 1950 }),
    });
    const out = await deriveMetadata(llm, { fullText: "text" });
    // The output type has no prose/eraYear fields; assert we only surfaced metadata.
    expect(Object.keys(out).sort()).toEqual(["modelId", "summary", "systemPrompt", "tags", "title"]);
  });

  it("falls back defensively when the model returns plain text (not JSON)", async () => {
    const llm = new ScriptedLanguageModel({ respond: "The day the barn burned down. It was 1961." });
    const out = await deriveMetadata(llm, { fullText: "The day the barn burned down. It was 1961." });
    expect(out.title).toBe("The day the barn burned down");
    expect(out.tags).toEqual([]);
  });

  it("caps an over-long title (reuses the render parser's caps)", async () => {
    const longTitle = "x".repeat(500);
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: longTitle, summary: "s", tags: [] }),
    });
    const out = await deriveMetadata(llm, { fullText: "some story" });
    expect(out.title.length).toBeLessThan(longTitle.length);
  });

  it("includes promptQuestion and narratorSpokenName in the user message when provided", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ title: "T", summary: "S", tags: [] }) });
    await deriveMetadata(llm, {
      fullText: "we moved a lot",
      promptQuestion: "Where did you grow up?",
      narratorSpokenName: "Rosa",
    });
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Rosa");
    expect(userMsg).toContain("Where did you grow up?");
    expect(userMsg).toContain("we moved a lot");
  });

  it("requests JSON output", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ title: "T", summary: "S", tags: [] }) });
    await deriveMetadata(llm, { fullText: "text" });
    expect(llm.calls[0]!.responseFormat).toBe("json");
  });

  // The following pin behaviors §5 relies on that currently rest entirely on the reused
  // `parseRenderResponse`. Asserting them at the deriveMetadata seam guards against a future
  // refactor of that reuse silently regressing the contract.

  it("filters non-string / empty tags out of the tag list", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: "T", summary: "S", tags: ["ok", 123, null, "", "  ", "good"] }),
    });
    const out = await deriveMetadata(llm, { fullText: "a story" });
    expect(out.tags).toEqual(["ok", "good"]);
  });

  it("caps the tag list at 8", async () => {
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: "T", summary: "S", tags: many }),
    });
    const out = await deriveMetadata(llm, { fullText: "a story" });
    expect(out.tags).toHaveLength(8);
  });

  it("whitespace-only model output falls back to Untitled with no tags (never throws)", async () => {
    const llm = new ScriptedLanguageModel({ respond: "   \n  " });
    const out = await deriveMetadata(llm, { fullText: "The barn burned down in 1961." });
    expect(out.title).toBe("Untitled");
    expect(out.tags).toEqual([]);
  });
});
