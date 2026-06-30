import { describe, expect, it } from "vitest";
import {
  isSentryEnabled,
  resolveClientDsn,
  resolveEnvironment,
  resolveServerDsn,
  resolveTracesSampleRate,
} from "@/lib/sentry-config";

const DSN = "https://abc123@o0.ingest.sentry.io/123";

describe("isSentryEnabled", () => {
  it("is enabled for a non-empty DSN", () => {
    expect(isSentryEnabled(DSN)).toBe(true);
  });

  it("is disabled for empty string", () => {
    expect(isSentryEnabled("")).toBe(false);
  });

  it("is disabled for whitespace-only string", () => {
    expect(isSentryEnabled("   ")).toBe(false);
  });

  it("is disabled for undefined / null", () => {
    expect(isSentryEnabled(undefined)).toBe(false);
    expect(isSentryEnabled(null)).toBe(false);
  });
});

describe("resolveClientDsn", () => {
  it("uses NEXT_PUBLIC_SENTRY_DSN", () => {
    expect(resolveClientDsn({ NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(DSN);
  });

  it("never falls back to the server-only SENTRY_DSN", () => {
    expect(resolveClientDsn({ SENTRY_DSN: DSN })).toBe("");
  });

  it("returns empty string when absent (Sentry stays a no-op)", () => {
    expect(isSentryEnabled(resolveClientDsn({}))).toBe(false);
  });
});

describe("resolveServerDsn", () => {
  it("prefers SENTRY_DSN", () => {
    expect(
      resolveServerDsn({ SENTRY_DSN: DSN, NEXT_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/9" }),
    ).toBe(DSN);
  });

  it("falls back to the public DSN", () => {
    expect(resolveServerDsn({ NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(DSN);
  });

  it("returns empty string when both absent (Sentry stays a no-op)", () => {
    expect(isSentryEnabled(resolveServerDsn({}))).toBe(false);
  });
});

describe("resolveTracesSampleRate", () => {
  it("defaults to 0.1", () => {
    expect(resolveTracesSampleRate({})).toBe(0.1);
  });

  it("honors a valid override", () => {
    expect(resolveTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "0.5" })).toBe(0.5);
  });

  it("ignores out-of-range or non-numeric values", () => {
    expect(resolveTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "5" })).toBe(0.1);
    expect(resolveTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "-1" })).toBe(0.1);
    expect(resolveTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "nope" })).toBe(0.1);
  });
});

describe("resolveEnvironment", () => {
  it("uses NODE_ENV", () => {
    expect(resolveEnvironment({ NODE_ENV: "production" })).toBe("production");
  });

  it("defaults to development", () => {
    expect(resolveEnvironment({})).toBe("development");
  });
});
