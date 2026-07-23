/**
 * `toAnswerExcerpt` grounds a follow-up question in the narrator's OWN words: it returns the
 * first 1–2 sentences of what they said (char-capped, never mid-word) so the phraser can quote
 * it and the LLM cannot confabulate the question subject from background anchors.
 */
import { describe, expect, it } from "vitest";
import { toAnswerExcerpt } from "../src/answer-excerpt";

describe("toAnswerExcerpt", () => {
  it("returns a single sentence unchanged (trimmed)", () => {
    expect(toAnswerExcerpt("  We drove all night to the coast.  ")).toBe(
      "We drove all night to the coast.",
    );
  });

  it("keeps at most the first two sentences", () => {
    const text =
      "First year of college my coach took me skiing. It snowed hard the whole week. We nearly got stranded.";
    expect(toAnswerExcerpt(text)).toBe(
      "First year of college my coach took me skiing. It snowed hard the whole week.",
    );
  });

  it("handles ! and ? as sentence terminators", () => {
    expect(toAnswerExcerpt("What a trip! I'll never forget it. Truly.")).toBe(
      "What a trip! I'll never forget it.",
    );
  });

  it("hard-caps very long text on a WORD boundary (no mid-word cut)", () => {
    // One long run-on sentence far past the ~240 cap; must trim back to a space, not mid-word.
    const word = "snow ";
    const text = word.repeat(80).trim(); // 400 chars, no terminator
    const out = toAnswerExcerpt(text);
    expect(out.length).toBeLessThanOrEqual(241); // 240 cap + optional trailing ellipsis
    // No partial word: every whitespace-split token is the whole word "snow" (or the ellipsis).
    for (const tok of out.replace(/…$/, "").trim().split(/\s+/)) {
      expect(tok).toBe("snow");
    }
    // Grounded in their words — a real prefix of the source.
    expect(text.startsWith(out.replace(/…$/, "").trim())).toBe(true);
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(toAnswerExcerpt("")).toBe("");
    expect(toAnswerExcerpt("   \n  ")).toBe("");
  });

  // A decimal point is NOT a sentence terminator. Before the fix, `4.5` split at the `.`,
  // producing a nonsensical fragment that was then quoted verbatim into the phraser prompt.
  it("does not treat a decimal in the FIRST sentence as a sentence end", () => {
    const text = "We skied 4.5 miles that day. It was freezing. We loved it.";
    // The first whole sentence contains the decimal intact; excerpt is the first two sentences.
    expect(toAnswerExcerpt(text)).toBe("We skied 4.5 miles that day. It was freezing.");
  });

  it("does not cut at a decimal in what would be the SECOND sentence (reported case)", () => {
    const text =
      "It snowed all week. We skied 4.5 miles that day. It was freezing.";
    // Must be a clean two whole sentences — never the mangled "It snowed all week. We skied 4."
    expect(toAnswerExcerpt(text)).toBe(
      "It snowed all week. We skied 4.5 miles that day.",
    );
  });

  it("does not treat a decimal with no following space at end-of-string as a sentence end", () => {
    const text = "The whole trip cost us 3.5";
    // No real terminator anywhere; the trailing decimal must not be read as a sentence break.
    expect(toAnswerExcerpt(text)).toBe("The whole trip cost us 3.5");
  });
});
