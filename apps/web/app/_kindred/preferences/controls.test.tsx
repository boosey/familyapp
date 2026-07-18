// @vitest-environment jsdom
/**
 * Integration: the folded-in bespoke controls (reading size, theme) still persist to localStorage and
 * apply to <html> — but now entirely through the preference registry/client, not hand-rolled logic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KindredFontScale } from "@/app/_kindred/KindredFontScale";
import { KindredThemePicker } from "@/app/_kindred/KindredThemePicker";
import { KindredSkinPicker } from "@/app/_kindred/KindredSkinPicker";
import { KindredMotionToggle } from "@/app/_kindred/KindredMotionToggle";
import { PREFERENCES } from "@/app/_kindred/preferences/registry";
import { common } from "@/app/_copy";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-skin");
  document.documentElement.removeAttribute("data-reduce-motion");
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

describe("KindredSkinPicker", () => {
  it("choosing a skin writes localStorage and sets data-skin", () => {
    render(<KindredSkinPicker />);
    fireEvent.click(screen.getByLabelText(hub.settings.skinLabels.heirloom));
    expect(localStorage.getItem(PREFERENCES.skin.storageKey)).toBe("heirloom");
    expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
  });

  it("re-applies the stored skin on mount", () => {
    localStorage.setItem(PREFERENCES.skin.storageKey, "heirloom");
    render(<KindredSkinPicker />);
    expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
  });
});

describe("KindredMotionToggle", () => {
  it("choosing on writes localStorage and sets data-reduce-motion", () => {
    render(<KindredMotionToggle />);
    fireEvent.click(screen.getByText(hub.settings.motionOnLabel));
    expect(localStorage.getItem(PREFERENCES.reduceMotion.storageKey)).toBe("on");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("on");
  });

  it("re-applies the stored motion preference on mount", () => {
    localStorage.setItem(PREFERENCES.reduceMotion.storageKey, "on");
    render(<KindredMotionToggle />);
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("on");
  });
});
