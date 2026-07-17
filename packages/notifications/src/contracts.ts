export type DeliveryChannel = "email" | "sms";

export type NotificationMessage =
  | { channel: "email"; to: string; subject: string; text: string; html?: string }
  | { channel: "sms"; to: string; text: string };

export type DeliveryResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string };

/** One external delivery vendor behind a vendor-neutral interface (Resend, Twilio). */
export interface Notifier {
  send(msg: NotificationMessage): Promise<DeliveryResult>;
}
