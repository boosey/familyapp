/**
 * The gap-driven follow-up is PHRASED by the existing phraser (issue #80): a `follow_up` intent with
 * `origin: "gap"` renders a targeted-but-open question. These tests assert the phraser builds the
 * gap-specific instruction (not the generic reflection block) and still forbids asserting the missing
 * fact — proving the loop stays a controlled interview, not an open chat.
 *
 * They also assert the gap-detection prompt is genuinely DATA: resolvable by purpose × vendor ×
 * version and delivered as the system message the mock LLM receives.
 */
import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "@chronicle/pipeline";
import { phraseIntent } from "../src/phraser";
import { extractGaps } from "../src/gap-detection";
import { resolveGapPrompt } from "../src/prompts/gap-prompts";

describe("phraser — gap-origin follow-up", () => {
  it("uses the gap instruction block (not the reflection block) and passes the seed + kind", async () => {
    const llm = new ScriptedLanguageModel({ respond: (req) => {
      const user = req.messages.find((m) => m.role === "user")!.content;
      // Echo the user prompt so the test can assert what the phraser built.
      return user;
    } });
    const res = await phraseIntent(llm, {
      intent: { kind: "follow_up", threadSeed: "who came to the wedding", origin: "gap", gapKind: "relational" },
      anchors: null,
      priorStories: [],
      isFirstSession: false,
    });
    expect(res.spokenText).toContain("who came to the wedding");
    expect(res.spokenText).toContain("relational gap");
    expect(res.spokenText.toLowerCase()).toContain("do not assume the answer");
    // It must NOT be the generic reflection framing.
    expect(res.spokenText).not.toContain("The narrator's last words");
  });

  it("a reflection-origin follow-up still renders the original block", async () => {
    const llm = new ScriptedLanguageModel({ respond: (req) => req.messages.find((m) => m.role === "user")!.content });
    const res = await phraseIntent(llm, {
      intent: { kind: "follow_up", threadSeed: "we packed up the whole house", origin: "reflection" },
      anchors: null,
      priorStories: [],
      isFirstSession: false,
    });
    expect(res.spokenText).toContain("The narrator's last words");
  });
});

describe("prompts-as-data — gap detection", () => {
  it("resolves by purpose × vendor × version and is the system message sent", async () => {
    const resolved = resolveGapPrompt({ version: "v1" });
    expect(resolved.purpose).toBe("gap_detection");
    expect(resolved.version).toBe("v1");
    expect(resolved.systemPrompt.length).toBeGreaterThan(0);

    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ gaps: [] }) });
    await extractGaps(llm, { questionText: "q", answerTranscript: "a ".repeat(20) }, { version: "v1" });
    const sys = llm.calls[0]!.messages.find((m) => m.role === "system")!.content;
    expect(sys).toBe(resolved.systemPrompt);
  });

  it("throws for an unknown version — a missing prompt is a programming error, not a blank message", () => {
    expect(() => resolveGapPrompt({ version: "v999" })).toThrow(/No prompt registered/);
  });
});
