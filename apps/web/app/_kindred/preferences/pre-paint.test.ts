// @vitest-environment jsdom
//
// Parity + drift guard for the registry-driven pre-paint script. Executing the generated script must
// reproduce the OLD hand-coded behavior (font size + theme applied to <html> from localStorage), and
// its output must match the TS `computeApplication` so the two hand-parallel appliers can't drift.
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PREFERENCES, PREFERENCES, buildPrePaintScript, computeApplication } from "./registry";

function runPrePaint(): void {
  // The script is a self-executing IIFE; eval runs it against the jsdom document/localStorage.
  // eslint-disable-next-line no-eval
  eval(buildPrePaintScript(ALL_PREFERENCES));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("pre-paint script", () => {
  it("applies stored reading size and theme to <html>", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "3"); // steps[3] = 14
    localStorage.setItem(PREFERENCES.theme.storageKey, "archive");
    runPrePaint();
    expect(document.documentElement.style.fontSize).toBe("14pt");
    expect(document.documentElement.getAttribute("data-theme")).toBe("archive");
  });

  it("falls back to declared defaults for missing/garbage values", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "99"); // out of range
    // theme key left unset
    runPrePaint();
    expect(document.documentElement.style.fontSize).toBe("10pt"); // default idx 1 → steps[1] = 10
    expect(document.documentElement.getAttribute("data-theme")).toBe("heirloom");
  });

  it("does not drift from the TS applier (computeApplication)", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "4");
    runPrePaint();
    const ts = computeApplication(PREFERENCES.readingSize, 4);
    expect(ts.target).toBe("root-font-size");
    expect(document.documentElement.style.fontSize).toBe(ts.value);
  });
});
