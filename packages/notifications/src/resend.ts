import { Resend } from "resend";
import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

type ResendLike = Pick<Resend, "emails">;

/** Email adapter. `from` is a verified Resend sender. Construct the client in the app runtime. */
export class ResendEmailAdapter implements Notifier {
  constructor(private readonly client: ResendLike, private readonly from: string) {}
  static fromApiKey(apiKey: string, from: string): ResendEmailAdapter {
    return new ResendEmailAdapter(new Resend(apiKey), from);
  }
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    if (msg.channel !== "email") throw new Error("ResendEmailAdapter handles email only");
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    } as any);
    if (error) return { ok: false, error: error.message };
    return { ok: true, providerId: data?.id };
  }
}
