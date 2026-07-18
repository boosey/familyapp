import twilio from "twilio";
import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

interface TwilioLike {
  messages: { create(opts: { from: string; to: string; body: string }): Promise<{ sid: string }> };
}

/** SMS adapter. `from` is a Twilio sending number (E.164). */
export class TwilioSmsAdapter implements Notifier {
  constructor(private readonly client: TwilioLike, private readonly from: string) {}
  static fromCredentials(accountSid: string, authToken: string, from: string): TwilioSmsAdapter {
    return new TwilioSmsAdapter(twilio(accountSid, authToken) as unknown as TwilioLike, from);
  }
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    if (msg.channel !== "sms") throw new Error("TwilioSmsAdapter handles sms only");
    try {
      const res = await this.client.messages.create({ from: this.from, to: msg.to, body: msg.text });
      return { ok: true, providerId: res.sid };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
