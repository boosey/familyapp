import { describe, expect, it, vi } from "vitest";
import { ResendEmailAdapter } from "../src/resend";

const fakeClient = (send: any) => ({ emails: { send } }) as any;

describe("ResendEmailAdapter", () => {
  it("maps an email message to resend.emails.send and returns providerId", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "re_1" }, error: null });
    const a = new ResendEmailAdapter(fakeClient(send), "Chronicle <no-reply@x.app>");
    const r = await a.send({ channel: "email", to: "a@b.com", subject: "S", text: "T", html: "<p>T</p>" });
    expect(send).toHaveBeenCalledWith({ from: "Chronicle <no-reply@x.app>", to: "a@b.com", subject: "S", text: "T", html: "<p>T</p>" });
    expect(r).toEqual({ ok: true, providerId: "re_1" });
  });
  it("returns ok:false on a resend error payload", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "bad" } });
    const a = new ResendEmailAdapter(fakeClient(send), "x");
    expect(await a.send({ channel: "email", to: "a@b.com", subject: "S", text: "T" })).toEqual({ ok: false, error: "bad" });
  });
  it("rejects a non-email message", async () => {
    const a = new ResendEmailAdapter(fakeClient(vi.fn()), "x");
    await expect(a.send({ channel: "sms", to: "+1", text: "T" })).rejects.toThrow();
  });
});
