/**
 * Verifies the runtime-switch wiring of the Sentry instrumentation files:
 *   - With NO DSN, `Sentry.init` is never called and the exported hooks (`onRequestError`,
 *     `onRouterTransitionStart`) are safe no-ops — they don't throw and emit no console noise.
 *   - With a DSN present, `Sentry.init` IS called exactly once (proves the gate is real, not always-off).
 *
 * `@sentry/nextjs` is mocked: we are asserting OUR enablement wiring, not the vendor SDK's internals.
 * Env is set before each dynamic import because the instrumentation modules read it at module-eval.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

const DSN = "https://abc123@o0.ingest.sentry.io/123";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("client instrumentation (instrumentation-client.ts)", () => {
  it("no DSN: does not init, and onRouterTransitionStart is a safe no-op", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.stubEnv("SENTRY_DSN", "");
    const Sentry = await import("@sentry/nextjs");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await import("@/instrumentation-client");

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(typeof mod.onRouterTransitionStart).toBe("function");
    expect(() => mod.onRouterTransitionStart("/somewhere", "navigate")).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("with DSN: calls Sentry.init exactly once", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const Sentry = await import("@sentry/nextjs");

    await import("@/instrumentation-client");

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect((Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      dsn: DSN,
    });
  });
});

describe("server/edge instrumentation (instrumentation.ts + sentry.server.config.ts)", () => {
  it("no DSN: register() does not throw and onRequestError is a safe no-op", async () => {
    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await import("@/instrumentation");

    // NEXT_RUNTIME is unset under vitest, so register() imports neither runtime config; the point
    // is that it resolves cleanly with no DSN.
    await expect(mod.register()).resolves.toBeUndefined();
    expect(typeof mod.onRequestError).toBe("function");
    expect(() =>
      mod.onRequestError(new Error("boom"), {} as never, {} as never),
    ).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("server config: no DSN does not init", async () => {
    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const Sentry = await import("@sentry/nextjs");

    await import("@/sentry.server.config");

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("server config: with SENTRY_DSN inits exactly once", async () => {
    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", DSN);
    const Sentry = await import("@sentry/nextjs");

    await import("@/sentry.server.config");

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
