import { describe, expect, it } from "vitest";
import { MockNotifier } from "../src/mock";

describe("MockNotifier", () => {
  it("records each send and returns ok by default", async () => {
    const n = new MockNotifier();
    const r = await n.send({ channel: "email", to: "a@b.com", subject: "Hi", text: "link" });
    expect(r).toEqual({ ok: true, providerId: expect.any(String) });
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]).toMatchObject({ channel: "email", to: "a@b.com" });
  });

  it("fails a scripted channel", async () => {
    const n = new MockNotifier({ failChannels: ["sms"] });
    const r = await n.send({ channel: "sms", to: "+15551230000", text: "link" });
    expect(r).toEqual({ ok: false, error: expect.any(String) });
  });
});
