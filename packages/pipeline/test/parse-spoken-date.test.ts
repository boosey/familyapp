import { describe, expect, it } from "vitest";
import { parseSpokenDate, parseSpokenDateResponse } from "../src/parse-spoken-date";
import { ScriptedLanguageModel } from "../src/mocks";

describe("parseSpokenDateResponse (tolerant parse)", () => {
  it("parses strict JSON with all three fields", () => {
    expect(parseSpokenDateResponse('{"year":1952,"month":3,"day":3}')).toEqual({
      year: 1952,
      month: 3,
      day: 3,
    });
  });

  it("keeps unstated fields null (month + year only)", () => {
    expect(parseSpokenDateResponse('{"year":1970,"month":6,"day":null}')).toEqual({
      year: 1970,
      month: 6,
      day: null,
    });
  });

  it("strips ```json fences before parsing", () => {
    expect(parseSpokenDateResponse('```json\n{"year":1980,"month":1,"day":15}\n```')).toEqual({
      year: 1980,
      month: 1,
      day: 15,
    });
  });

  it("clamps out-of-range fields to null (Feb-31, five-digit year, month 13)", () => {
    expect(parseSpokenDateResponse('{"year":19999,"month":13,"day":31}')).toEqual({
      year: null,
      month: null,
      day: 31,
    });
  });

  it("coerces numeric strings, rejects non-integers", () => {
    expect(parseSpokenDateResponse('{"year":"1952","month":"3","day":"3.5"}')).toEqual({
      year: 1952,
      month: 3,
      day: null,
    });
  });

  it("returns all-null on non-JSON / no date", () => {
    expect(parseSpokenDateResponse("I didn't catch a date")).toEqual({
      year: null,
      month: null,
      day: null,
    });
  });
});

describe("parseSpokenDate", () => {
  it("no-ops on empty transcript without calling the model", async () => {
    const llm = new ScriptedLanguageModel({ respond: "SHOULD NOT BE USED" });
    expect(await parseSpokenDate(llm, "   ")).toEqual({ year: null, month: null, day: null });
    expect(llm.calls.length).toBe(0);
  });

  it("passes the transcript to the model and returns the validated date", async () => {
    const llm = new ScriptedLanguageModel({ respond: '{"year":1952,"month":3,"day":3}' });
    const out = await parseSpokenDate(llm, "March third, nineteen fifty-two");
    expect(out).toEqual({ year: 1952, month: 3, day: 3 });
    expect(llm.calls[0]!.messages[1]!.content).toContain("March third, nineteen fifty-two");
  });
});
