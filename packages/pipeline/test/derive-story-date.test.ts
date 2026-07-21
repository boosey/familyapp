import { describe, expect, it } from "vitest";
import { BACKSTOP_PROVENANCE_SUFFIX, deriveStoryDate } from "../src/derive-story-date";

describe("deriveStoryDate (finish-time backstop, ADR-0026 #246)", () => {
  it("resolves a stated year to a year-aligned period, with the backstop provenance marker", () => {
    const out = deriveStoryDate({ fullText: "We moved to Ohio in 1962." });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("period");
    expect(out.occurrence.date).toBe("1962-01-01");
    expect(out.occurrence.endDate).toBe("1962-12-31");
    expect(out.occurrence.provenance).toBe(`stated year "1962" ${BACKSTOP_PROVENANCE_SUFFIX}`);
  });

  it("resolves an age reference against the narrator's birthDate", () => {
    const out = deriveStoryDate({
      fullText: "When I was 8, we moved to Cherry Street.",
      birthDate: "1935-06-15",
    });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("period");
    expect(out.occurrence.date).toBe("1943-06-15");
    expect(out.occurrence.endDate).toBe("1944-06-14");
    expect(out.occurrence.provenance).toBe(`age 8, from birthdate ${BACKSTOP_PROVENANCE_SUFFIX}`);
  });

  it("resolves an anchor-relative reference against a known life event", () => {
    const out = deriveStoryDate({
      fullText: "About ten years after we married, we bought the farm.",
      lifeEvents: [{ kind: "wedding", date: "1958-03-01" }],
    });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("circa");
    expect(out.occurrence.date).toBe("1968-03-01");
    expect(out.occurrence.endDate).toBeNull();
    expect(out.occurrence.provenance).toContain("wedding life event");
    expect(out.occurrence.provenance).toContain(BACKSTOP_PROVENANCE_SUFFIX);
  });

  it("leaves an underivable text unresolvable (the story stays honestly Undated)", () => {
    expect(deriveStoryDate({ fullText: "We had a dog named Biscuit." })).toEqual({
      status: "unresolvable",
    });
  });

  it("never throws on garbage input (empty text, malformed birthDate, no anchors)", () => {
    expect(deriveStoryDate({ fullText: "" })).toEqual({ status: "unresolvable" });
    expect(
      deriveStoryDate({
        fullText: undefined as unknown as string,
        birthDate: "not-a-date",
        lifeEvents: undefined,
      }),
    ).toEqual({ status: "unresolvable" });
  });
});
