import { describe, expect, it } from "vitest";
import { coerce, computeApplication, PREFERENCES, type PreferenceDef } from "./registry";
import { FONT_SIZE_STEPS_PT, DEFAULT_FONT_SIZE_INDEX } from "@/lib/constants";
import { FONT_SIZE_STORAGE_KEY } from "@/app/_kindred/font-scale-constants";
import { SKIN_IDS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY } from "@/app/_kindred/skin-constants";
import { REDUCE_MOTION_VALUES, DEFAULT_REDUCE_MOTION, MOTION_STORAGE_KEY } from "@/app/_kindred/motion-constants";
import {
  RECORDING_GESTURE_VALUES,
  DEFAULT_RECORDING_GESTURE,
  RECORDING_GESTURE_PHONE_STORAGE_KEY,
  RECORDING_GESTURE_DESKTOP_STORAGE_KEY,
} from "@/app/_kindred/recording-gesture-constants";

const fontDef: PreferenceDef = {
  key: "reading-size",
  storageKey: "kin-font-size",
  default: 1,
  validate: { kind: "int-index", length: 5 },
  apply: { strategy: "root-font-size", steps: [8, 10, 12, 14, 18], unit: "pt" },
};

describe("coerce — int-index (reading size)", () => {
  it("keeps a valid in-range index", () => {
    expect(coerce(fontDef, "3")).toBe(3);
    expect(coerce(fontDef, "0")).toBe(0);
  });

  it("falls back to the declared default when absent — NOT index 0 (ADR-0020 fix)", () => {
    // Regression: the old `Number(null) === 0` path silently gave new users the smallest size.
    expect(coerce(fontDef, null)).toBe(1);
    expect(coerce(fontDef, "")).toBe(1);
  });

  it("treats a whitespace-only value as absent — NOT index 0 (Number(' ') === 0)", () => {
    // Regression: without trimming, `Number(" ")` is 0 and would validate as int-index 0.
    expect(coerce(fontDef, "   ")).toBe(1);
    // A padded valid index is still accepted (trimmed before Number()).
    expect(coerce(fontDef, " 3 ")).toBe(3);
  });

  it("rejects out-of-range and non-integer values → default", () => {
    expect(coerce(fontDef, "5")).toBe(1); // length is 5 → valid indices 0..4
    expect(coerce(fontDef, "-1")).toBe(1);
    expect(coerce(fontDef, "2.5")).toBe(1);
    expect(coerce(fontDef, "abc")).toBe(1);
  });
});

describe("computeApplication", () => {
  it("root-font-size maps the stored index to a sized fontSize string", () => {
    expect(computeApplication(fontDef, 2)).toEqual({ target: "root-font-size", value: "12pt" });
  });
  it("data-attr yields the attribute name and the value verbatim", () => {
    expect(computeApplication(PREFERENCES.skin, "heirloom")).toEqual({
      target: "data-attr",
      attr: "data-skin",
      value: "heirloom",
    });
  });

  it("css-var yields the variable name and value, suffixing the unit when present", () => {
    const unitless: PreferenceDef = {
      key: "density",
      storageKey: "kin-density",
      default: "1",
      validate: { kind: "enum", values: ["1", "1.15", "1.3"] },
      apply: { strategy: "css-var", cssVar: "--density" },
    };
    const withUnit: PreferenceDef = {
      key: "gutter",
      storageKey: "kin-gutter",
      default: "8",
      validate: { kind: "enum", values: ["8", "12", "16"] },
      apply: { strategy: "css-var", cssVar: "--gutter", unit: "px" },
    };
    expect(computeApplication(unitless, "1.15")).toEqual({ target: "css-var", name: "--density", value: "1.15" });
    expect(computeApplication(withUnit, "12")).toEqual({ target: "css-var", name: "--gutter", value: "12px" });
  });

  it("root-font-size degenerates to 0 (never `undefined`) when steps are empty — matches the script", () => {
    const empty: PreferenceDef = {
      key: "x",
      storageKey: "x",
      default: 0,
      validate: { kind: "int-index", length: 1 },
      apply: { strategy: "root-font-size", steps: [], unit: "pt" },
    };
    expect(computeApplication(empty, 0)).toEqual({ target: "root-font-size", value: "0pt" });
  });
});

describe("PREFERENCES registry parity with the folded-in constants", () => {
  it("reading size preserves the existing default, steps, and storage key", () => {
    expect(PREFERENCES.readingSize.default).toBe(DEFAULT_FONT_SIZE_INDEX);
    expect(PREFERENCES.readingSize.storageKey).toBe(FONT_SIZE_STORAGE_KEY);
    expect(PREFERENCES.readingSize.apply).toMatchObject({ steps: FONT_SIZE_STEPS_PT, unit: "pt" });
  });
});

describe("coerce — enum (skin aliases)", () => {
  it("maps stale playful storage to scrapbook (not default-only coincidence)", () => {
    expect(coerce(PREFERENCES.skin, "playful")).toBe("scrapbook");
    expect(coerce(PREFERENCES.skin, "  playful  ")).toBe("scrapbook");
  });
  it("keeps canonical scrapbook / heirloom", () => {
    expect(coerce(PREFERENCES.skin, "scrapbook")).toBe("scrapbook");
    expect(coerce(PREFERENCES.skin, "heirloom")).toBe("heirloom");
  });
  it("falls back to scrapbook default for unknown skin ids", () => {
    expect(coerce(PREFERENCES.skin, "midnight")).toBe("scrapbook");
    expect(coerce(PREFERENCES.skin, null)).toBe("scrapbook");
  });
});

describe("PREFERENCES registry — skin + reduce-motion", () => {
  it("skin is an enum data-attr writing data-skin, defaulting to scrapbook", () => {
    expect(PREFERENCES.skin.default).toBe(DEFAULT_SKIN_ID);
    expect(PREFERENCES.skin.storageKey).toBe(SKIN_STORAGE_KEY);
    expect(PREFERENCES.skin.validate).toMatchObject({ kind: "enum", values: SKIN_IDS });
    expect(PREFERENCES.skin.apply).toEqual({ strategy: "data-attr", attr: "data-skin" });
    expect(PREFERENCES.skin.aliases).toEqual({ playful: "scrapbook" });
  });
  it("reduceMotion is an on/off enum writing data-reduce-motion", () => {
    expect(PREFERENCES.reduceMotion.default).toBe(DEFAULT_REDUCE_MOTION);
    expect(PREFERENCES.reduceMotion.storageKey).toBe(MOTION_STORAGE_KEY);
    expect(PREFERENCES.reduceMotion.validate).toMatchObject({ kind: "enum", values: REDUCE_MOTION_VALUES });
    expect(PREFERENCES.reduceMotion.apply).toEqual({ strategy: "data-attr", attr: "data-reduce-motion" });
  });
});

describe("PREFERENCES registry — recording gesture (js-read)", () => {
  it("phone + desktop prefs default to tap, use js-read, and share tap|hold values", () => {
    expect(PREFERENCES.recordingGesturePhone.default).toBe(DEFAULT_RECORDING_GESTURE);
    expect(PREFERENCES.recordingGestureDesktop.default).toBe(DEFAULT_RECORDING_GESTURE);
    expect(DEFAULT_RECORDING_GESTURE).toBe("tap");
    expect(PREFERENCES.recordingGesturePhone.storageKey).toBe(RECORDING_GESTURE_PHONE_STORAGE_KEY);
    expect(PREFERENCES.recordingGestureDesktop.storageKey).toBe(RECORDING_GESTURE_DESKTOP_STORAGE_KEY);
    expect(PREFERENCES.recordingGesturePhone.validate).toMatchObject({
      kind: "enum",
      values: RECORDING_GESTURE_VALUES,
    });
    expect(PREFERENCES.recordingGestureDesktop.validate).toMatchObject({
      kind: "enum",
      values: RECORDING_GESTURE_VALUES,
    });
    expect(PREFERENCES.recordingGesturePhone.apply).toEqual({ strategy: "js-read" });
    expect(PREFERENCES.recordingGestureDesktop.apply).toEqual({ strategy: "js-read" });
  });

  it("computeApplication returns js-read (no DOM shape) for recording gesture", () => {
    expect(computeApplication(PREFERENCES.recordingGesturePhone, "hold")).toEqual({ target: "js-read" });
    expect(computeApplication(PREFERENCES.recordingGestureDesktop, "tap")).toEqual({ target: "js-read" });
  });

  it("coerce accepts tap/hold and falls back to tap for garbage/absent", () => {
    expect(coerce(PREFERENCES.recordingGesturePhone, "hold")).toBe("hold");
    expect(coerce(PREFERENCES.recordingGesturePhone, "tap")).toBe("tap");
    expect(coerce(PREFERENCES.recordingGesturePhone, null)).toBe("tap");
    expect(coerce(PREFERENCES.recordingGesturePhone, "swipe")).toBe("tap");
    expect(coerce(PREFERENCES.recordingGestureDesktop, "  hold  ")).toBe("hold");
  });
});
