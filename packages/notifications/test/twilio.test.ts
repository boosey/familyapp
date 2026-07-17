import { describe, expect, it, vi } from "vitest";
import { TwilioSmsAdapter } from "../src/twilio";

const fake = (create: any) => ({ messages: { create } }) as any;

describe("TwilioSmsAdapter", () => {
  it("maps an sms message to messages.create and returns the sid", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    const a = new TwilioSmsAdapter(fake(create), "+15550001111");
    const r = await a.send({ channel: "sms", to: "+15551230000", text: "join: link" });
    expect(create).toHaveBeenCalledWith({ from: "+15550001111", to: "+15551230000", body: "join: link" });
    expect(r).toEqual({ ok: true, providerId: "SM1" });
  });
  it("returns ok:false when the client throws", async () => {
    const create = vi.fn().mockRejectedValue(new Error("21610 unsubscribed"));
    const a = new TwilioSmsAdapter(fake(create), "+1");
    expect(await a.send({ channel: "sms", to: "+1", text: "x" })).toEqual({ ok: false, error: "21610 unsubscribed" });
  });
  it("rejects a non-sms message", async () => {
    const a = new TwilioSmsAdapter(fake(vi.fn()), "+1");
    await expect(a.send({ channel: "email", to: "a@b.com", subject: "s", text: "t" })).rejects.toThrow();
  });
});
