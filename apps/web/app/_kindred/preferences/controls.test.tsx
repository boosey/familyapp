// @vitest-environment jsdom
/**
 * Integration: the folded-in bespoke controls (reading size, skin, motion, recording gesture) still
 * persist to localStorage and apply to <html> — but now entirely through the preference
 * registry/client, not hand-rolled logic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { KindredFontScale } from "@/app/_kindred/KindredFontScale";
import { KindredSkinPicker } from "@/app/_kindred/KindredSkinPicker";
import { KindredMotionToggle } from "@/app/_kindred/KindredMotionToggle";
import { KindredRecordingGesturePicker } from "@/app/_kindred/KindredRecordingGesturePicker";
import { PREFERENCES } from "@/app/_kindred/preferences/registry";
import { common } from "@/app/_copy";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
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

describe("KindredSkinPicker", () => {
  it("choosing a skin writes localStorage and sets data-skin", () => {
    render(<KindredSkinPicker />);
    fireEvent.click(screen.getByLabelText(hub.settings.skinLabels.heirloom));
    expect(localStorage.getItem(PREFERENCES.skin.storageKey)).toBe("heirloom");
    expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
  });

  it("shows Scrapbook (not Playful) as the warm-skin label", () => {
    render(<KindredSkinPicker />);
    expect(screen.getByLabelText(hub.settings.skinLabels.scrapbook)).toBeTruthy();
    expect(screen.getByText(hub.settings.skinShort.scrapbook).textContent).toBe("Scrapbook");
    expect(screen.queryByText("Playful")).toBeNull();
  });

  it("re-applies the stored skin on mount", () => {
    localStorage.setItem(PREFERENCES.skin.storageKey, "heirloom");
    render(<KindredSkinPicker />);
    expect(document.documentElement.getAttribute("data-skin")).toBe("heirloom");
  });

  it("coerces stale kin-skin=playful to scrapbook on mount", () => {
    localStorage.setItem(PREFERENCES.skin.storageKey, "playful");
    render(<KindredSkinPicker />);
    expect(document.documentElement.getAttribute("data-skin")).toBe("scrapbook");
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

describe("KindredRecordingGesturePicker", () => {
  it("choosing phone hold writes the phone storage key (not desktop)", () => {
    render(<KindredRecordingGesturePicker />);
    const phoneGroup = screen.getByRole("group", {
      name: hub.settings.recordingGesturePhoneAria,
    });
    fireEvent.click(within(phoneGroup).getByRole("button", { name: hub.settings.recordingGestureHoldLabel }));
    expect(localStorage.getItem(PREFERENCES.recordingGesturePhone.storageKey)).toBe("hold");
    expect(localStorage.getItem(PREFERENCES.recordingGestureDesktop.storageKey)).toBeNull();
  });

  it("choosing desktop tap writes the desktop storage key (not phone)", () => {
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "hold");
    render(<KindredRecordingGesturePicker />);
    const desktopGroup = screen.getByRole("group", {
      name: hub.settings.recordingGestureDesktopAria,
    });
    fireEvent.click(within(desktopGroup).getByRole("button", { name: hub.settings.recordingGestureTapLabel }));
    expect(localStorage.getItem(PREFERENCES.recordingGestureDesktop.storageKey)).toBe("tap");
    expect(localStorage.getItem(PREFERENCES.recordingGesturePhone.storageKey)).toBeNull();
  });

  it("js-read apply does not mutate the document when choosing", () => {
    render(<KindredRecordingGesturePicker />);
    const phoneGroup = screen.getByRole("group", {
      name: hub.settings.recordingGesturePhoneAria,
    });
    fireEvent.click(within(phoneGroup).getByRole("button", { name: hub.settings.recordingGestureHoldLabel }));
    expect(document.documentElement.getAttribute("data-recording-gesture")).toBeNull();
  });
});
