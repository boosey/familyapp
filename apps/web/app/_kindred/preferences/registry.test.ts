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
  it("theme preserves the existing default, ids, and storage key", () => {
    expect(PREFERENCES.theme.default).toBe(DEFAULT_THEME_ID);
    expect(PREFERENCES.theme.storageKey).toBe(THEME_STORAGE_KEY);
    expect(PREFERENCES.theme.validate).toMatchObject({ kind: "enum", values: THEME_IDS });
  });
});
