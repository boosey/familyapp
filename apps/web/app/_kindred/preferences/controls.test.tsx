// @vitest-environment jsdom
/**
 * Integration: the folded-in bespoke controls (reading size, theme) still persist to localStorage and
 * apply to <html> — but now entirely through the preference registry/client, not hand-rolled logic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KindredFontScale } from "@/app/_kindred/KindredFontScale";
import { KindredThemePicker } from "@/app/_kindred/KindredThemePicker";
import { PREFERENCES } from "@/app/_kindred/preferences/registry";
import { common } from "@/app/_copy";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("KindredFontScale", () => {
  it("choosing a size writes localStorage and sets the root font size", () => {
    render(<KindredFontScale />);
    fireEvent.click(screen.getByLabelText(common.fontScale.labels[4]!)); // largest → steps[4] = 18
    expect(localStorage.getItem(PREFERENCES.readingSize.storageKey)).toBe("4");
    expect(document.documentElement.style.fontSize).toBe("18pt");
  });

  it("re-applies the stored size on mount", () => {
    localStorage.setItem(PREFERENCES.readingSize.storageKey, "3"); // steps[3] = 14
    render(<KindredFontScale />);
    expect(document.documentElement.style.fontSize).toBe("14pt");
  });
});

describe("KindredThemePicker", () => {
  it("choosing a palette writes localStorage and sets data-theme", () => {
    render(<KindredThemePicker />);
    fireEvent.click(screen.getByLabelText(hub.settings.paletteLabels.archive));
    expect(localStorage.getItem(PREFERENCES.theme.storageKey)).toBe("archive");
    expect(document.documentElement.getAttribute("data-theme")).toBe("archive");
  });

  it("re-applies the stored palette on mount", () => {
    localStorage.setItem(PREFERENCES.theme.storageKey, "hearth");
    render(<KindredThemePicker />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("hearth");
  });
});
