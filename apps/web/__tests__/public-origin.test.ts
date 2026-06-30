/**
 * Regression tests for resolvePublicOrigin (issue #5): invite/magic links must resolve to the real
 * public host in production and must NEVER emit a localhost URL there.
 */
import { describe, expect, it } from "vitest";
import { resolvePublicOrigin } from "../lib/public-origin";

describe("resolvePublicOrigin", () => {
  it("prefers APP_BASE_URL over headers and strips trailing slashes", () => {
    expect(
      resolvePublicOrigin({
        configuredBaseUrl: "https://app.example.com/",
        host: "internal-host:3000",
        forwardedProto: "http",
        isProduction: true,
      }),
    ).toBe("https://app.example.com");
  });

  it("trims whitespace around APP_BASE_URL", () => {
    expect(
      resolvePublicOrigin({ configuredBaseUrl: "  https://app.example.com  ", isProduction: true }),
    ).toBe("https://app.example.com");
  });

  it("builds from Host + x-forwarded-proto when no APP_BASE_URL", () => {
    expect(
      resolvePublicOrigin({
        host: "chronicle.example.com",
        forwardedProto: "https",
        isProduction: true,
      }),
    ).toBe("https://chronicle.example.com");
  });

  it("defaults scheme to https in production when the proto header is absent", () => {
    expect(
      resolvePublicOrigin({ host: "chronicle.example.com", isProduction: true }),
    ).toBe("https://chronicle.example.com");
  });

  it("defaults scheme to http in dev when the proto header is absent", () => {
    expect(
      resolvePublicOrigin({ host: "localhost:3000", isProduction: false }),
    ).toBe("http://localhost:3000");
  });

  it("falls back to localhost ONLY in dev when no config and no Host header", () => {
    expect(resolvePublicOrigin({ isProduction: false })).toBe("http://localhost:3000");
  });

  it("THROWS in production when there is no APP_BASE_URL and no Host header (never emits localhost)", () => {
    expect(() => resolvePublicOrigin({ isProduction: true })).toThrow(/APP_BASE_URL/);
    expect(() => resolvePublicOrigin({ host: null, forwardedProto: null, isProduction: true })).toThrow(
      /no Host header/,
    );
  });

  it("throws when APP_BASE_URL has no scheme (would otherwise yield a dead relative link)", () => {
    expect(() =>
      resolvePublicOrigin({ configuredBaseUrl: "app.example.com", isProduction: true }),
    ).toThrow(/scheme/);
    // also rejected in dev — a schemeless base URL is always wrong
    expect(() =>
      resolvePublicOrigin({ configuredBaseUrl: "app.example.com", isProduction: false }),
    ).toThrow(/scheme/);
  });

  it("treats an empty/whitespace APP_BASE_URL as unset (falls through to headers)", () => {
    expect(
      resolvePublicOrigin({
        configuredBaseUrl: "   ",
        host: "chronicle.example.com",
        forwardedProto: "https",
        isProduction: true,
      }),
    ).toBe("https://chronicle.example.com");
  });
});
