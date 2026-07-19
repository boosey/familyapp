// @vitest-environment jsdom
/**
 * useIsCompact (ADR-0024) — the viewport hook the hub tabs branch on. These guards prove the two
 * load-bearing properties: (1) the server/first-paint snapshot is `false` (desktop/inline) so SSR and
 * hydration agree and desktop never flashes; and (2) on a phone-width match it reports `true` after
 * mount, and it re-reads when the media query changes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useIsCompact } from "./useIsCompact";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // @ts-expect-error — remove the stub between tests.
  delete window.matchMedia;
});

function Probe() {
  return <span data-testid="v">{String(useIsCompact())}</span>;
}

/** Install a matchMedia stub whose `.matches` is `matches`, capturing the change listener. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    fire(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe("useIsCompact", () => {
  it("returns false when server-rendered (no window/matchMedia flash)", () => {
    // renderToStaticMarkup runs with getServerSnapshot → must be the desktop/inline default.
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain(">false<");
  });

  it("reports true on a phone-width match after mount", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("v").textContent).toBe("true");
  });

  it("reports false on a desktop-width match", () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId("v").textContent).toBe("false");
  });

  it("re-reads when the media query changes (desktop → phone)", () => {
    const mm = stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId("v").textContent).toBe("false");
    act(() => mm.fire(true));
    expect(screen.getByTestId("v").textContent).toBe("true");
  });
});
