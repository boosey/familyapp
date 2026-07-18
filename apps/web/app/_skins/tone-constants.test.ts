import { describe, expect, it } from "vitest";
import { TONE_VALUES, DEFAULT_TONE, TONE_ATTR } from "./tone-constants";

describe("tone constants", () => {
  it("is a warm/solemn enum defaulting to warm, written as data-tone", () => {
    expect(TONE_VALUES).toEqual(["warm", "solemn"]);
    expect(DEFAULT_TONE).toBe("warm");
    expect(TONE_ATTR).toBe("data-tone");
  });
});
