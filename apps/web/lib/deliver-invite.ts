import type { Database } from "@chronicle/db";
import type { DeliveryChannel, Notifier } from "@chronicle/notifications";
import { getInvitationDeliveryContext, recordInviteDelivery } from "@chronicle/core";
import { invitations as copy } from "@/app/_copy/invitations";

/** Deliver the invite link over the requested channels (best-effort) and record the outcome. */
export async function deliverInvite(args: {
  db: Database;
  notifier: Notifier;
  invitationId: string;
  channels: DeliveryChannel[];
  link: string;
}): Promise<void> {
  const ctx = await getInvitationDeliveryContext(args.db, args.invitationId);
  if (!ctx) return; // invitation vanished (e.g. revoked) — nothing to deliver
  let delivered = false;
  const errors: string[] = [];
  for (const channel of args.channels) {
    if (channel === "email" && ctx.inviteeEmail) {
      const r = await args.notifier.send({
        channel: "email",
        to: ctx.inviteeEmail,
        subject: copy.email.subject(ctx.familyName),
        text: copy.email.text(ctx.inviterName, ctx.familyName, args.link),
      });
      if (r.ok) delivered = true;
      else errors.push(`email: ${r.error}`);
    } else if (channel === "sms" && ctx.inviteePhone) {
      const r = await args.notifier.send({
        channel: "sms",
        to: ctx.inviteePhone,
        text: copy.sms.text(ctx.inviterName, args.link),
      });
      if (r.ok) delivered = true;
      else errors.push(`sms: ${r.error}`);
    }
  }
  await recordInviteDelivery(args.db, args.invitationId, {
    deliveredAt: delivered ? new Date() : undefined,
    deliveryError: errors.length ? errors.join("; ") : undefined,
  });
}
