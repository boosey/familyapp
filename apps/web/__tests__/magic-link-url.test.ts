/**
 * Unit tests for the pure magic-link redirect helpers (lib/magic-link.ts) — ADR-0003, Slice 2 Task B.
 *
 * These are pure string functions: no DB, no Clerk, no cookies. The properties that matter are the
 * open-redirect guard (a hostile `dest` must never escape to an external origin) and that the
 * redeem URL round-trips its params through URLSearchParams.
 */
import { describe, expect, it } from "vitest";
import {
  buildRedeemUrl,
  resolveMagicLinkTarget,
  safeInternalDest,
} from "../lib/magic-link";

describe("safeInternalDest", () => {
  const FALLBACK = "/hub";

  it("passes a safe internal absolute path", () => {
    expect(
      safeInternalDest(
        "/hub/answer/11111111-2222-3333-4444-555555555555",
        FALLBACK,
      ),
    ).toBe("/hub/answer/11111111-2222-3333-4444-555555555555");
  });

  it("passes an internal path with a query string", () => {
    expect(safeInternalDest("/hub?tab=questions", FALLBACK)).toBe(
      "/hub?tab=questions",
    );
  });

  it("rejects a protocol-relative URL (//evil.com) → fallback", () => {
    expect(safeInternalDest("//evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a backslash protocol-relative trick (/\\evil.com) → fallback", () => {
    expect(safeInternalDest("/\\evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects an absolute https URL → fallback", () => {
    expect(safeInternalDest("https://evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects an absolute http URL → fallback", () => {
    expect(safeInternalDest("http://x", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a javascript: scheme → fallback", () => {
    expect(safeInternalDest("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a path not starting with '/' → fallback", () => {
    expect(safeInternalDest("hub", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects empty / null / undefined → fallback", () => {
    expect(safeInternalDest("", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalDest(null, FALLBACK)).toBe(FALLBACK);
    expect(safeInternalDest(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a control char that a browser might normalize into a host → fallback", () => {
    expect(safeInternalDest("/\thub", FALLBACK)).toBe(FALLBACK);
    expect(safeInternalDest("/ho\nst", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a percent-encoded protocol-relative URL (/%2F%2Fevil.com) → fallback", () => {
    // The App Router can decode %2F during route matching, turning this into "//evil.com".
    expect(safeInternalDest("/%2F%2Fevil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a DOUBLE percent-encoded slash trick (/%252F%252Fevil.com) → fallback", () => {
    // %252F → %2F → "/"; the decode-to-fixed-point recursion must catch the second layer.
    expect(safeInternalDest("/%252F%252Fevil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a percent-encoded backslash (/%5Cevil.com) → fallback", () => {
    expect(safeInternalDest("/%5Cevil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects malformed percent-encoding (decodeURIComponent throws) → fallback", () => {
    expect(safeInternalDest("/%E0%A4%A", FALLBACK)).toBe(FALLBACK);
  });
});

describe("buildRedeemUrl", () => {
  it("produces /auth/redeem with ticket, dest and token query params", () => {
    const url = buildRedeemUrl({
      ticket: "tk_1",
      dest: "/hub",
      token: "abc",
    });
    expect(url.startsWith("/auth/redeem?")).toBe(true);
    const params = new URLSearchParams(url.slice("/auth/redeem?".length));
    expect(params.get("ticket")).toBe("tk_1");
    expect(params.get("dest")).toBe("/hub");
    expect(params.get("token")).toBe("abc");
  });

  it("URL-encodes a dest containing ? and & so it round-trips", () => {
    const dest = "/hub/answer/x?tab=a&flag=1";
    const url = buildRedeemUrl({ ticket: "t k", dest, token: "a&b=c" });
    // The raw URL must not leak the un-encoded special chars into the outer query string.
    expect(url).not.toContain("tab=a&flag=1");
    const params = new URLSearchParams(url.slice("/auth/redeem?".length));
    expect(params.get("dest")).toBe(dest);
    expect(params.get("ticket")).toBe("t k");
    expect(params.get("token")).toBe("a&b=c");
  });
});

describe("resolveMagicLinkTarget", () => {
  it("established → the destination unchanged", () => {
    expect(
      resolveMagicLinkTarget(
        { kind: "established" },
        { destination: "/hub/answer/abc", token: "tok" },
      ),
    ).toBe("/hub/answer/abc");
  });

  it("handoff → the redeem URL carrying ticket, dest and token", () => {
    const target = resolveMagicLinkTarget(
      { kind: "handoff", ticket: "tk_xyz" },
      { destination: "/hub?tab=questions", token: "tok_9" },
    );
    expect(target.startsWith("/auth/redeem?")).toBe(true);
    const params = new URLSearchParams(target.slice("/auth/redeem?".length));
    expect(params.get("ticket")).toBe("tk_xyz");
    expect(params.get("dest")).toBe("/hub?tab=questions");
    expect(params.get("token")).toBe("tok_9");
  });
});
