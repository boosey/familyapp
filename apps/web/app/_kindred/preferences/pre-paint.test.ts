// @vitest-environment jsdom
//
// Parity + drift guard for the registry-driven pre-paint script. Executing the generated script must
// reproduce the OLD hand-coded behavior (font size applied to <html> from localStorage), and
// its output must match the TS `computeApplication` so the two hand-parallel appliers can't drift.
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALL_PREFERENCES,
  PREFERENCES,
  buildPrePaintScript,
  computeApplication,
  type PreferenceDef,
} from "./registry";

function runPrePaint(): void {
  // The script is a self-executing IIFE; eval runs it against the jsdom document/localStorage.
  // eslint-disable-next-line no-eval
  eval(buildPrePaintScript(ALL_PREFERENCES));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-skin");
  document.documentElement.removeAttribute("data-reduce-motion");
});

describe("pre-paint script", () => {
  it("applies stored reading size to <html>", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "3"); // steps[3] = 14
    runPrePaint();
    expect(document.documentElement.style.fontSize).toBe("14pt");
  });

  it("falls back to declared defaults for missing/garbage values", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "99"); // out of range
    runPrePaint();
    expect(document.documentElement.style.fontSize).toBe("10pt"); // default idx 1 → steps[1] = 10
  });

  it("applies stored skin and reduce-motion to <html>", () => {
    localStorage.setItem(PREFERENCES.skin.storageKey, "heirloom");
    localStorage.setItem(PREFERENCES.reduceMotion.storageKey, "on");
    runPrePaint();
    expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("on");
  });

  it("defaults skin=scrapbook, reduce-motion=off when unset", () => {
    runPrePaint();
    expect(document.documentElement.getAttribute("data-skin")).toBe("scrapbook");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("off");
  });

  it("coerces stale kin-skin=playful to scrapbook (pre-paint alias)", () => {
    localStorage.setItem(PREFERENCES.skin.storageKey, "playful");
    runPrePaint();
    expect(document.documentElement.getAttribute("data-skin")).toBe("scrapbook");
  });

  it("ignores js-read preferences (no crash, no spurious DOM attrs)", () => {
    localStorage.setItem(PREFERENCES.recordingGesturePhone.storageKey, "hold");
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "hold");
    runPrePaint();
    // Skin/reduce-motion defaults still apply; js-read must not invent attrs or CSS vars.
    expect(document.documentElement.getAttribute("data-skin")).toBe("scrapbook");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("off");
    expect(document.documentElement.getAttribute("data-recording-gesture")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--recording-gesture")).toBe("");
    const dataAttrs = [...document.documentElement.attributes]
      .map((a) => a.name)
      .filter((n) => n.startsWith("data-"));
    expect(dataAttrs).toEqual(expect.arrayContaining(["data-skin", "data-reduce-motion"]));
    expect(dataAttrs).not.toContain("data-recording-gesture");
  });

  it("does not drift from the TS applier (computeApplication)", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "4");
    runPrePaint();
    const ts = computeApplication(PREFERENCES.readingSize, 4);
    expect(ts.target).toBe("root-font-size");
    if (ts.target !== "root-font-size") throw new Error("expected root-font-size");
    expect(document.documentElement.style.fontSize).toBe(ts.value);
  });
});

describe("pre-paint script — css-var strategy & degenerate steps (drift guard for the un-consumed paths)", () => {
  it("sets a CSS custom property (with unit) from a css-var preference, matching the TS applier", () => {
    const gutter: PreferenceDef = {
      key: "gutter",
      storageKey: "kin-gutter",
      default: "8",
      validate: { kind: "enum", values: ["8", "12", "16"] },
      apply: { strategy: "css-var", cssVar: "--gutter", unit: "px" },
    };
    localStorage.setItem(gutter.storageKey, "12");
    // eslint-disable-next-line no-eval
    eval(buildPrePaintScript([gutter]));
    const ts = computeApplication(gutter, "12");
    expect(ts).toEqual({ target: "css-var", name: "--gutter", value: "12px" });
    expect(document.documentElement.style.getPropertyValue("--gutter")).toBe("12px");
  });

  it("root-font-size with empty steps yields '0pt' in the script (no 'undefinedpt' drift)", () => {
    const empty: PreferenceDef = {
      key: "x",
      storageKey: "kin-x",
      default: 0,
      validate: { kind: "int-index", length: 1 },
      apply: { strategy: "root-font-size", steps: [], unit: "pt" },
    };
    localStorage.setItem(empty.storageKey, "0");
    // eslint-disable-next-line no-eval
    eval(buildPrePaintScript([empty]));
    const ts = computeApplication(empty, 0);
    expect(ts.target).toBe("root-font-size");
    if (ts.target !== "root-font-size") throw new Error("expected root-font-size");
    expect(document.documentElement.style.fontSize).toBe(ts.value);
    expect(document.documentElement.style.fontSize).toBe("0pt");
  });
});
