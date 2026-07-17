import { describe, expect, it } from "vitest";
import { SKIN_IDS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY } from "./skin-constants";
import { REDUCE_MOTION_VALUES, DEFAULT_REDUCE_MOTION, MOTION_STORAGE_KEY } from "./motion-constants";

describe("skin constants", () => {
  it("ships playful (default) and heirloom", () => {
    expect(SKIN_IDS).toEqual(["playful", "heirloom"]);
    expect(DEFAULT_SKIN_ID).toBe("playful");
    expect(SKIN_IDS).toContain(DEFAULT_SKIN_ID);
  });
  it("has a stable storage key", () => {
    expect(SKIN_STORAGE_KEY).toBe("kin-skin");
  });
});

describe("reduce-motion constants", () => {
  it("is an on/off enum defaulting to off", () => {
    expect(REDUCE_MOTION_VALUES).toEqual(["on", "off"]);
    expect(DEFAULT_REDUCE_MOTION).toBe("off");
    expect(MOTION_STORAGE_KEY).toBe("kin-reduce-motion");
  });
});
