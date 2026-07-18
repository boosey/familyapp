/**
 * Unit tests for the invite-token seal/open helper (#116) — pure crypto, no database.
 * Key resolution order: injected key → INVITE_TOKEN_ENC_KEY env → the fixed dev-only fallback.
 */
import { describe, expect, it } from "vitest";
import { openToken, resolveSealKey, sealToken } from "../src/token-seal";

const KEY_A = Buffer.alloc(32, 0xa);
const KEY_B = Buffer.alloc(32, 0xb);

describe("sealToken / openToken", () => {
  it("round-trips a token under an injected key", () => {
    const sealed = sealToken("raw-token-123", KEY_A);
    expect(sealed).not.toContain("raw-token-123");
    expect(openToken(sealed, KEY_A)).toBe("raw-token-123");
  });

  it("produces a different payload each time (random IV)", () => {
    expect(sealToken("same", KEY_A)).not.toBe(sealToken("same", KEY_A));
  });

  it("returns null under the WRONG key (caller treats as unrecoverable → rotate)", () => {
    const sealed = sealToken("raw-token-123", KEY_A);
    expect(openToken(sealed, KEY_B)).toBeNull();
  });

  it("returns null for missing or malformed payloads", () => {
    expect(openToken(null, KEY_A)).toBeNull();
    expect(openToken(undefined, KEY_A)).toBeNull();
    expect(openToken("garbage", KEY_A)).toBeNull();
    expect(openToken("v2.aa.bb.cc", KEY_A)).toBeNull(); // unknown version
  });

  it("round-trips under the dev-only fallback key when no env/injected key is set", () => {
    const sealed = sealToken("dev-token");
    expect(openToken(sealed)).toBe("dev-token");
  });
});

describe("resolveSealKey", () => {
  it("prefers the injected key over everything", () => {
    expect(resolveSealKey(KEY_A, { INVITE_TOKEN_ENC_KEY: KEY_B.toString("base64") })).toBe(KEY_A);
  });

  it("decodes a base64 env key", () => {
    expect(resolveSealKey(undefined, { INVITE_TOKEN_ENC_KEY: KEY_A.toString("base64") })).toEqual(
      KEY_A,
    );
  });

  it("decodes a 64-char hex env key", () => {
    expect(resolveSealKey(undefined, { INVITE_TOKEN_ENC_KEY: KEY_A.toString("hex") })).toEqual(
      KEY_A,
    );
  });

  it("falls back to the dev-only key when the env var is unset or blank", () => {
    const dev = resolveSealKey(undefined, {});
    expect(dev).toHaveLength(32);
    expect(resolveSealKey(undefined, { INVITE_TOKEN_ENC_KEY: "   " })).toEqual(dev);
  });
});
