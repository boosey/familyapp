import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

export class MockNotifier implements Notifier {
  readonly sent: NotificationMessage[] = [];
  constructor(private readonly opts: { failChannels?: ("email" | "sms")[] } = {}) {}
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    this.sent.push(msg);
    if (this.opts.failChannels?.includes(msg.channel)) {
      return { ok: false, error: `mock: ${msg.channel} delivery failed` };
    }
    return { ok: true, providerId: `mock-${this.sent.length}` };
  }
}
