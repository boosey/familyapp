import { describe, expect, it } from "vitest";
import {
  inviteChannelPlanErrorMessage,
  parseInviteIntent,
  parseSmsConsent,
  planInviteChannels,
} from "../lib/invite-delivery-channels";

describe("parseInviteIntent (#118)", () => {
  it("passes through the two send actions", () => {
    expect(parseInviteIntent("send_email")).toBe("send_email");
    expect(parseInviteIntent("send_phone")).toBe("send_phone");
  });

  it("defaults an unknown or empty intent to get_link (delivers nothing)", () => {
    expect(parseInviteIntent("get_link")).toBe("get_link");
    expect(parseInviteIntent("")).toBe("get_link");
    expect(parseInviteIntent("send_carrier_pigeon")).toBe("get_link");
  });
});

describe("parseSmsConsent", () => {
  it("accepts standard checkbox / truthy form values", () => {
    expect(parseSmsConsent("on")).toBe(true);
    expect(parseSmsConsent("true")).toBe(true);
    expect(parseSmsConsent("1")).toBe(true);
  });

  it("rejects missing or falsey values (unchecked checkbox omits the field)", () => {
    expect(parseSmsConsent(null)).toBe(false);
    expect(parseSmsConsent("")).toBe(false);
    expect(parseSmsConsent("off")).toBe(false);
  });
});

describe("planInviteChannels (#118)", () => {
  it("send_email with an email yields ['email'] only — even when a phone was also entered", () => {
    expect(
      planInviteChannels("send_email", {
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
      }),
    ).toEqual({ ok: true, channels: ["email"] });
  });

  it("send_email without an email is a form error, never a silent get-link", () => {
    expect(
      planInviteChannels("send_email", { email: "  ", normalizedPhone: "+15551230000" }),
    ).toEqual({ ok: false, reason: "email_required" });
  });

  it("send_phone with phone + SMS consent yields ['sms'] only", () => {
    expect(
      planInviteChannels("send_phone", {
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
        smsConsent: true,
      }),
    ).toEqual({ ok: true, channels: ["sms"] });
  });

  it("send_phone without a phone is a form error", () => {
    expect(
      planInviteChannels("send_phone", {
        email: "sal@example.com",
        normalizedPhone: null,
        smsConsent: true,
      }),
    ).toEqual({ ok: false, reason: "phone_required" });
  });

  it("send_phone with a phone but no SMS consent is a form error", () => {
    expect(
      planInviteChannels("send_phone", {
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
        smsConsent: false,
      }),
    ).toEqual({ ok: false, reason: "sms_consent_required" });
    expect(
      planInviteChannels("send_phone", {
        email: null,
        normalizedPhone: "+15551230000",
      }),
    ).toEqual({ ok: false, reason: "sms_consent_required" });
  });

  it("get_link delivers nothing regardless of the contacts entered", () => {
    expect(
      planInviteChannels("get_link", {
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
      }),
    ).toEqual({ ok: true, channels: [] });
  });
});

describe("inviteChannelPlanErrorMessage", () => {
  const copy = {
    emailRequired: "need email",
    phoneRequired: "need phone",
    smsConsentRequired: "need consent",
  };

  it("maps each plan failure reason to the matching copy string", () => {
    expect(inviteChannelPlanErrorMessage("email_required", copy)).toBe("need email");
    expect(inviteChannelPlanErrorMessage("phone_required", copy)).toBe("need phone");
    expect(inviteChannelPlanErrorMessage("sms_consent_required", copy)).toBe("need consent");
  });
});
