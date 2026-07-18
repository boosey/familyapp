/**
 * Tests for the invite-token envelope (lib/invite-token-seal.ts) — the AES-256-GCM seal that
 * keeps the raw invite token out of the persisted Inngest job payload (issue #103).
 *
 * The invariant under test: a leaked `invite.send` payload yields only ciphertext, restoring
 * "leak ≠ working invite" (see docs/DECISIONS.md). So the pinned behaviors are: round-trip
 * correctness, random-IV non-determinism (equal tokens never produce equal ciphertext), the
 * raw token never appearing in the sealed blob, and hard failure on wrong key / tampering.
 * `getInviteTokenEncKey` pins the env-decode contract (base64 → exactly 32 bytes), mirroring
 * `getGooglePhotosEncryptionKey`'s shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInviteTokenEncKey,
  openInviteToken,
  sealInviteToken,
} from "../lib/invite-token-seal";

const KEY = Buffer.alloc(32, 7);
const KEY_B64 = KEY.toString("base64");
const ENV = "INVITE_TOKEN_ENC_KEY";

describe("sealInviteToken / openInviteToken", () => {
  it("round-trips: open(seal(token)) === token", () => {
    const sealed = sealInviteToken("raw-invite-token-abc123", KEY);
    expect(openInviteToken(sealed, KEY)).toBe("raw-invite-token-abc123");
  });

  it("never embeds the raw token in the sealed blob", () => {
    const token = "raw-invite-token-abc123";
    const sealed = sealInviteToken(token, KEY);
    expect(sealed).not.toContain(token);
    // Base64 blobs can coincidentally contain substrings; decode and check the raw bytes too.
    expect(Buffer.from(sealed, "base64").toString("utf8")).not.toContain(token);
  });

  it("uses a random IV: sealing the same token twice yields different ciphertext", () => {
    const a = sealInviteToken("same-token", KEY);
    const b = sealInviteToken("same-token", KEY);
    expect(a).not.toBe(b);
    expect(openInviteToken(a, KEY)).toBe("same-token");
    expect(openInviteToken(b, KEY)).toBe("same-token");
  });

  it("throws on the wrong key (GCM auth tag mismatch)", () => {
    const sealed = sealInviteToken("raw-token", KEY);
    const otherKey = Buffer.alloc(32, 9);
    expect(() => openInviteToken(sealed, otherKey)).toThrow();
  });

  it("throws on a tampered blob (flipped ciphertext byte fails auth)", () => {
    const sealed = sealInviteToken("raw-token", KEY);
    const raw = Buffer.from(sealed, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => openInviteToken(raw.toString("base64"), KEY)).toThrow();
  });

  it("throws on a truncated/garbage blob", () => {
    expect(() => openInviteToken("AAAA", KEY)).toThrow(/too short/);
    expect(() => openInviteToken("not-a-real-blob!!!", KEY)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => sealInviteToken("t", Buffer.alloc(16))).toThrow(/32 bytes/);
    expect(() => openInviteToken("AAAA", Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("getInviteTokenEncKey", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it("decodes a base64 32-byte key from INVITE_TOKEN_ENC_KEY", () => {
    process.env[ENV] = KEY_B64;
    expect(getInviteTokenEncKey()).toEqual(KEY);
  });

  it("throws naming the var when unset", () => {
    expect(() => getInviteTokenEncKey()).toThrow(/INVITE_TOKEN_ENC_KEY is missing/);
  });

  it("throws naming the var when set to empty/whitespace", () => {
    process.env[ENV] = "   ";
    expect(() => getInviteTokenEncKey()).toThrow(/INVITE_TOKEN_ENC_KEY is missing/);
  });

  it("throws when the decoded key is not 32 bytes", () => {
    process.env[ENV] = Buffer.alloc(16, 1).toString("base64");
    expect(() => getInviteTokenEncKey()).toThrow(/must decode to 32 bytes/);
  });
});
