/**
 * HMAC album upload ticket (issue #20) — the key→minter binding that stops `record` / the dev receiver
 * from being driven with a forged or foreign key. Round-trip + every tamper/expiry/mismatch path.
 */
import { describe, expect, it } from "vitest";
import { createUploadTicket, verifyUploadTicket } from "@/lib/upload-ticket";

const KEY = "family-photos/abc-123";
const PERSON = "person-1";

describe("upload ticket", () => {
  it("round-trips a valid ticket back to its bound key + person", () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    expect(verifyUploadTicket(ticket)).toEqual({ key: KEY, personId: PERSON });
  });

  it("round-trips a key that contains slashes and special chars", () => {
    const weird = "family-photos/a.b-c_d/e";
    const ticket = createUploadTicket({ key: weird, personId: PERSON });
    expect(verifyUploadTicket(ticket)).toEqual({ key: weird, personId: PERSON });
  });

  it("rejects a tampered signature", () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    expect(verifyUploadTicket(`${ticket}x`)).toBeNull();
  });

  it("rejects a payload swapped under a stale signature (key change)", () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const parts = ticket.split(".");
    // Replace the key segment with a different (valid base64url) key but keep the old signature.
    parts[1] = Buffer.from("family-photos/evil").toString("base64url");
    expect(verifyUploadTicket(parts.join("."))).toBeNull();
  });

  it("rejects an expired ticket", () => {
    const now = 1_000_000;
    const ticket = createUploadTicket({ key: KEY, personId: PERSON, ttlSeconds: 60 }, now);
    // 61s later → expired.
    expect(verifyUploadTicket(ticket, now + 61_000)).toBeNull();
    // Still valid just before expiry.
    expect(verifyUploadTicket(ticket, now + 59_000)).toEqual({ key: KEY, personId: PERSON });
  });

  it("rejects a malformed ticket (wrong segment count)", () => {
    expect(verifyUploadTicket("a.b.c")).toBeNull();
    expect(verifyUploadTicket("")).toBeNull();
    expect(verifyUploadTicket("only-one-part")).toBeNull();
  });
});
