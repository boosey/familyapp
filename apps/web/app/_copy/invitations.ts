// apps/web/app/_copy/invitations.ts
// Copy for invitation delivery messages (email + SMS). Dynamic bits are arrow fns.
import { common } from "./common";

export const invitations = {
  email: {
    subject: (familyName: string) => `You're invited to join ${familyName} on ${common.appName}`,
    text: (inviterName: string, familyName: string, link: string) =>
      `${inviterName} invited you to join ${familyName} on ${common.appName}.\n\nOpen this link to accept:\n${link}\n\nThis link is personal to you — please don't forward it.`,
  },
  sms: {
    // Twilio Messaging Policy: the initial SMS must include a clear opt-out (STOP) path.
    text: (inviterName: string, link: string) =>
      `${inviterName} invited you to join their family on ${common.appName}: ${link} Reply STOP to opt out, HELP for help. Msg & data rates may apply.`,
  },
} as const;
