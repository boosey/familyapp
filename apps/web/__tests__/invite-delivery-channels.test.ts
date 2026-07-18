import { describe, expect, it } from "vitest";
import {
  parseInviteIntent,
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

  it("send_phone with a normalized phone yields ['sms'] only", () => {
    expect(
      planInviteChannels("send_phone", {
        email: "sal@example.com",
        normalizedPhone: "+15551230000",
      }),
    ).toEqual({ ok: true, channels: ["sms"] });
  });

  it("send_phone without a phone is a form error", () => {
    expect(
      planInviteChannels("send_phone", { email: "sal@example.com", normalizedPhone: null }),
    ).toEqual({ ok: false, reason: "phone_required" });
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
