/**
 * Unit test for the client `clog` seam (ADR-0014 Inc 5). The one genuinely testable logging seam:
 * the server `plog` facility is a module-load no-op under VITEST, but `clog` reads its toggles at
 * call time (env once at import, localStorage per-call), so its gate is exercisable here. Asserts the
 * quiet-by-default no-op AND the two enable paths (env flag + localStorage flag), spying on
 * console.info and restoring it each time. Runs in the default node env — `window`/`localStorage`
 * are stubbed on globalThis where needed (and torn down) so nothing leaks across tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEY = "NEXT_PUBLIC_CHRONICLE_CLIENT_LOG";

/**
 * `clog` reads the env flag ONCE at module load, so each env scenario needs a fresh module import.
 * Reset the module registry and import a clean copy after setting the env.
 */
async function freshClog() {
  vi.resetModules();
  return (await import("../lib/clog")).clog;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env[ENV_KEY];
  delete (globalThis as { window?: unknown }).window;
});

describe("clog — quiet by default", () => {
  it("is a no-op (no console.info) when neither toggle is set", async () => {
    delete process.env[ENV_KEY];
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const clog = await freshClog();
    clog("record_start", { story: "s1" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("clog — env toggle", () => {
  it("logs a [chronicle:client] line with formatted fields when the env flag is '1'", async () => {
    process.env[ENV_KEY] = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const clog = await freshClog();
    clog("take_appended", { story: "abc", kind: "voice", appended: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(
      "[chronicle:client] take_appended story=abc kind=voice appended=true",
    );
  });

  it("drops undefined fields and quotes values with whitespace", async () => {
    process.env[ENV_KEY] = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const clog = await freshClog();
    clog("finish", { intent: "probe", skip: undefined, note: "a b" });
    expect(spy.mock.calls[0]![0]).toBe('[chronicle:client] finish intent=probe note="a b"');
  });
});

describe("clog — localStorage toggle", () => {
  it("logs when window.localStorage['chronicle:clog'] === '1' even with the env flag unset", async () => {
    delete process.env[ENV_KEY];
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (k === "chronicle:clog" ? "1" : null) },
    };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const clog = await freshClog();
    clog("polish_tap", { story: "z9" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("[chronicle:client] polish_tap story=z9");
  });

  it("stays a no-op when localStorage.getItem throws", async () => {
    delete process.env[ENV_KEY];
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const clog = await freshClog();
    clog("record_start");
    expect(spy).not.toHaveBeenCalled();
  });
});
