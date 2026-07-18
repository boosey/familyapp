import { describe, expect, it } from "vitest";
import { resolveInviteChannels } from "../lib/invite-delivery-channels";

describe("resolveInviteChannels", () => {
  it("email-only: a valid email and no phone yields [\"email\"]", () => {
    expect(
      resolveInviteChannels({ email: "sal@example.com", normalizedPhone: null, smsConsent: false }),
    ).toEqual(["email"]);
  });

  it("sms-only: a normalized phone with consent and no email yields [\"sms\"]", () => {
    expect(
      resolveInviteChannels({ email: null, normalizedPhone: "+15551230000", smsConsent: true }),
    ).toEqual(["sms"]);
  });

  it("both: email + consented phone yields [\"email\",\"sms\"]", () => {
    expect(
      resolveInviteChannels({
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
        smsConsent: true,
      }),
    ).toEqual(["email", "sms"]);
  });

  it("neither: no email and no phone yields []", () => {
    expect(resolveInviteChannels({ email: null, normalizedPhone: null, smsConsent: false })).toEqual(
      [],
    );
  });

  it("phone without consent: does not include sms", () => {
    expect(
      resolveInviteChannels({ email: null, normalizedPhone: "+15551230000", smsConsent: false }),
    ).toEqual([]);
  });

  it("empty-string email: does not include email", () => {
    expect(
      resolveInviteChannels({ email: "   ", normalizedPhone: null, smsConsent: false }),
    ).toEqual([]);
  });
});
