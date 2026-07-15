import { describe, expect, it } from "vitest";
import { coerce, computeApplication, PREFERENCES, type PreferenceDef } from "./registry";
import { FONT_SIZE_STEPS_PT, DEFAULT_FONT_SIZE_INDEX } from "@/lib/constants";
import { FONT_SIZE_STORAGE_KEY } from "@/app/_kindred/font-scale-constants";
import { THEME_IDS, DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@/app/_kindred/theme-constants";

const fontDef: PreferenceDef = {
  key: "reading-size",
  storageKey: "kin-font-size",
  default: 1,
  validate: { kind: "int-index", length: 5 },
  apply: { strategy: "root-font-size", steps: [8, 10, 12, 14, 18], unit: "pt" },
};

const themeDef: PreferenceDef = {
  key: "theme",
  storageKey: "kin-theme",
  default: "heirloom",
  validate: { kind: "enum", values: ["heirloom", "archive", "hearth"] },
  apply: { strategy: "data-attr", attr: "data-theme" },
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

  it("rejects out-of-range and non-integer values → default", () => {
    expect(coerce(fontDef, "5")).toBe(1); // length is 5 → valid indices 0..4
    expect(coerce(fontDef, "-1")).toBe(1);
    expect(coerce(fontDef, "2.5")).toBe(1);
    expect(coerce(fontDef, "abc")).toBe(1);
  });
});

describe("coerce — enum (theme)", () => {
  it("keeps a known theme id", () => {
    expect(coerce(themeDef, "archive")).toBe("archive");
  });
  it("falls back to default for unknown / absent", () => {
    expect(coerce(themeDef, "midnight")).toBe("heirloom");
    expect(coerce(themeDef, null)).toBe("heirloom");
  });
});

describe("computeApplication", () => {
  it("root-font-size maps the stored index to a sized fontSize string", () => {
    expect(computeApplication(fontDef, 2)).toEqual({ target: "root-font-size", value: "12pt" });
  });
  it("data-attr yields the attribute name and the value verbatim", () => {
    expect(computeApplication(themeDef, "archive")).toEqual({
      target: "data-attr",
      attr: "data-theme",
      value: "archive",
    });
  });
});

describe("PREFERENCES registry parity with the folded-in constants", () => {
  it("reading size preserves the existing default, steps, and storage key", () => {
    expect(PREFERENCES.readingSize.default).toBe(DEFAULT_FONT_SIZE_INDEX);
    expect(PREFERENCES.readingSize.storageKey).toBe(FONT_SIZE_STORAGE_KEY);
    expect(PREFERENCES.readingSize.apply).toMatchObject({ steps: FONT_SIZE_STEPS_PT, unit: "pt" });
  });
  it("theme preserves the existing default, ids, and storage key", () => {
    expect(PREFERENCES.theme.default).toBe(DEFAULT_THEME_ID);
    expect(PREFERENCES.theme.storageKey).toBe(THEME_STORAGE_KEY);
    expect(PREFERENCES.theme.validate).toMatchObject({ kind: "enum", values: THEME_IDS });
  });
});
