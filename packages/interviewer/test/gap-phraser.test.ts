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

  it("system-origin temporal follow-up includes gentle dating guidance", async () => {
    const llm = new ScriptedLanguageModel({
      respond: (req) => req.messages.find((m) => m.role === "user")!.content,
    });
    const res = await phraseIntent(llm, {
      intent: {
        kind: "follow_up",
        threadSeed: "about when this happened",
        origin: "system",
        gapKind: "temporal",
      },
      anchors: null,
      priorStories: [],
      isFirstSession: false,
    });
    expect(res.spokenText).toContain("about when this happened");
    expect(res.spokenText).toContain("WHEN question");
    expect(res.spokenText).toContain("NEVER ask for, or imply you need, an exact date");
    expect(res.spokenText).not.toContain("The narrator's last words");
  });

  // A NON-temporal gap (relational/spatial/causal/identity) is BY DEFINITION a detail the narrator
  // did NOT say. The strict temporal grounding ("ask ONLY about what they said here, never about
  // anything else") would contradict the seed instruction to invite the missing detail. So a
  // non-temporal gap must use the SOFTER grounding: still block anchor-confabulation, still quote
  // the story, but ask about the missing detail AS PART OF that story.
  it("non-temporal gap grounds SOFTLY — keeps seed + excerpt, drops the strict 'only what they said' phrase", async () => {
    const wedding =
      "We got married in a little chapel by the lake, just the two of us and the pastor.";
    const llm = new ScriptedLanguageModel({
      respond: (req) => req.messages.find((m) => m.role === "user")!.content,
    });
    const res = await phraseIntent(llm, {
      intent: {
        kind: "follow_up",
        threadSeed: "who came to the wedding",
        origin: "gap",
        gapKind: "relational",
        answerExcerpt: wedding,
      },
      anchors: null,
      priorStories: [],
      isFirstSession: false,
    });
    // Both the missing-detail seed AND the grounding excerpt are present.
    expect(res.spokenText).toContain("who came to the wedding");
    expect(res.spokenText).toContain(wedding);
    // Soft framing, NOT the strict temporal wording (which would forbid the missing detail).
    expect(res.spokenText).not.toContain("ask ONLY about what they said here");
    expect(res.spokenText).toContain("the missing detail above AS PART OF that story");
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

  // Regression for the skiing-trip confabulation (system temporal probe emitted the contentless
  // seed "about when this happened"; the phraser's CONTEXT block carried hometown/current-location
  // anchors; with nothing concrete to anchor "this happened" to, the LLM fused the two location
  // anchors into an invented "move" event and asked when THAT happened).
  //
  // A mock LLM cannot reproduce the LLM's confabulation itself. The correct regression seam for a
  // prompt-construction fix is the PROMPT: assert the built messages now (a) GROUND the question in
  // the narrator's own words (the answerExcerpt), and (b) carry an ABSOLUTE rule forbidding anchors
  // as the subject of the question.
  it("temporal system follow-up grounds in the narrator's words and forbids anchors as subject", async () => {
    const skiing =
      "First year of college, my high school football coach took me on a skiing trip between Christmas and New Year's.";
    // Capture the exact system + user messages the phraser hands the LLM.
    const llm = new ScriptedLanguageModel({
      respond: (req) => {
        const system = req.messages.find((m) => m.role === "system")!.content;
        const user = req.messages.find((m) => m.role === "user")!.content;
        return JSON.stringify({ system, user });
      },
    });
    const res = await phraseIntent(llm, {
      intent: {
        kind: "follow_up",
        threadSeed: "about when this happened",
        origin: "system",
        gapKind: "temporal",
        answerExcerpt: skiing,
      },
      anchors: {
        personId: "p-alex",
        spokenName: "Alex",
        birthYear: null,
        birthDate: null,
        lifeEvents: [],
        profile: {
          hometown: "Mandeville",
          currentLocation: "New Orleans",
          occupationSummary: null,
          siblingContext: null,
          hasChildren: null,
          hasGrandchildren: null,
        },
      },
      priorStories: [],
      isFirstSession: false,
    });
    const { system, user } = JSON.parse(res.spokenText) as { system: string; user: string };

    // (a) Grounding: the narrator's own words are quoted in the USER prompt so "when did THIS
    // happen" refers to the skiing trip, not to any anchor.
    expect(user).toContain(skiing);
    // Temporal keeps the STRICT grounding: "when" genuinely refers back to the told story.
    expect(user).toContain("ask ONLY about what they said here");
    // Anchors are still present as background (names/tone) — but the grounding must dominate.
    expect(user).toContain("Mandeville");
    expect(user).toContain("New Orleans");

    // (b) Anti-anchor rule: the SYSTEM prompt now forbids making an anchor the subject.
    expect(system).toContain("BACKGROUND ONLY");
    expect(system.toLowerCase()).toContain("never make an anchor the subject");
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
