// apps/web/app/_copy/questions-for-me-pings.ts
// Outbound "Ask became actionable" ping copy (email) — #276. No full ask/story prose — a short
// question teaser line is fine, but nothing beyond that.
import { common } from "./common";

export const questionsForMePings = {
  subject: (askerName: string) => `${askerName} has a question for you`,
  text: (askerName: string, questionText: string, link: string) =>
    `${askerName} asked you a question on ${common.appName}:\n\n"${questionText}"\n\nAnswer it here:\n${link}`,
} as const;
