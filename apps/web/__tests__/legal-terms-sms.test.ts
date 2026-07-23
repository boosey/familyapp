/**
 * Guard: the Terms and Conditions "Text Messaging (SMS)" section carries the disclosures
 * Twilio A2P 10DLC / toll-free verification (and CTIA carrier policy) require on a public page.
 *
 * These strings are load-bearing for messaging approval — if a copy edit drops one, this test
 * fails BEFORE the change ships and re-triggers a Twilio re-review, rather than silently
 * regressing the compliance page. It asserts presence, not exact wording, so honest edits pass.
 */
import { describe, expect, it } from "vitest";
import { legal } from "@/app/_copy/legal";

const smsSection = legal.terms.sections.find((s) => s.id === "sms");

/** Flatten every paragraph + list item in the SMS section into one searchable blob. */
const smsText = (smsSection?.blocks ?? [])
  .flatMap((b) => ("p" in b ? [b.p] : [...b.list]))
  .join("\n");

describe("Terms & Conditions — SMS disclosure (Twilio A2P)", () => {
  it("has a dedicated Text Messaging (SMS) section", () => {
    expect(smsSection).toBeDefined();
    expect(smsSection?.heading).toMatch(/text messag|sms/i);
  });

  it("names the messaging provider (Twilio)", () => {
    expect(smsText).toMatch(/twilio/i);
  });

  it("discloses opt-out via STOP and help via HELP", () => {
    expect(smsText).toContain("STOP");
    expect(smsText).toContain("HELP");
  });

  it("discloses that message and data rates may apply", () => {
    expect(smsText).toMatch(/message and data rates may apply/i);
  });

  it("discloses message frequency", () => {
    expect(smsText).toMatch(/frequency/i);
  });

  it("states mobile opt-in data is not shared/sold to third parties for marketing", () => {
    expect(smsText).toMatch(/not (share|sell)|do not (share|sell)/i);
    expect(smsText).toMatch(/third part/i);
  });

  it("links messaging consent back to the Privacy Policy", () => {
    expect(smsText).toMatch(/privacy policy/i);
  });

  it("provides a contact/help address", () => {
    expect(smsText).toContain(legal.terms.contactEmail);
  });
});
