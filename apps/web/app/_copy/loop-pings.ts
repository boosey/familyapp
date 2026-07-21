// apps/web/app/_copy/loop-pings.ts
// Outbound loop-event ping copy (email). No story prose — teaser only.
import { common } from "./common";

export const loopPings = {
  family: {
    subject: (narratorName: string) =>
      `A story landed for you from ${narratorName}`,
    text: (narratorName: string, title: string | null, link: string) => {
      const about = title ? ` about "${title}"` : "";
      return `${narratorName} shared a story${about} on ${common.appName}.\n\nOpen it here:\n${link}`;
    },
  },
  asker: {
    subject: (narratorName: string) =>
      `${narratorName} answered your question`,
    text: (narratorName: string, title: string | null, link: string) => {
      const about = title ? ` ("${title}")` : "";
      return `${narratorName} answered your question${about} on ${common.appName}.\n\nListen here:\n${link}`;
    },
  },
} as const;
