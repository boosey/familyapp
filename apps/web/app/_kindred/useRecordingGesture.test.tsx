// @vitest-environment jsdom
/**
 * useRecordingGesture — form-factor resolver over the phone/desktop recording-gesture prefs.
 * Compact viewport → phone pref; otherwise → desktop pref.
 * First paint is always tap (SSR/hydration safe); stored value applies after mount.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useRecordingGesture } from "./useRecordingGesture";
import { PREFERENCES } from "./preferences/registry";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  // @ts-expect-error — remove the stub between tests.
  delete window.matchMedia;
});

function Probe() {
  const { holdToRecord } = useRecordingGesture();
  return <span data-testid="v">{holdToRecord ? "hold" : "tap"}</span>;
}

function stubMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
}

describe("useRecordingGesture", () => {
  it("SSR markup is tap (never reads localStorage during render)", () => {
    // Even if the client later has hold stored, the server HTML must stay on the default so
    // hydration agrees with useState(false) on the client's first paint.
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain(">tap<");
  });

  it("defaults to tap (not hold) when nothing is stored", async () => {
    stubMatchMedia(false);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tap"));
  });

  it("on compact viewport reads the phone preference after mount", async () => {
    localStorage.setItem(PREFERENCES.recordingGesturePhone.storageKey, "hold");
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "tap");
    stubMatchMedia(true);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("hold"));
  });

  it("on desktop viewport reads the desktop preference after mount", async () => {
    localStorage.setItem(PREFERENCES.recordingGesturePhone.storageKey, "tap");
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "hold");
    stubMatchMedia(false);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("hold"));
  });

  it("does not cross-read: compact ignores desktop hold when phone is tap", async () => {
    localStorage.setItem(PREFERENCES.recordingGesturePhone.storageKey, "tap");
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "hold");
    stubMatchMedia(true);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tap"));
  });
});
