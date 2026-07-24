/**
 * Account › Notifications — section-specific copy (ADR-0029). The account-level notification-stream
 * preferences relocated from /hub/settings. Owns this section's heading/intro, per-stream labels,
 * frequency labels and save-state hints (formerly `hub.settings.*`).
 */
import type { NotificationStream } from "@chronicle/db";

export const notificationsCopy = {
  notificationsHeading: "Notifications",
  notificationsIntro:
    "Choose how often you hear from Tell Me Again. These choices sync across your devices.",
  notificationsSaving: "Saving…",
  notificationsSaved: "Saved",
  notificationsSaveError: "Could not save — try again.",
  streamLabels: {
    questions_for_me: "Questions for me",
    answers_to_my_asks: "Answers to my asks",
    family_activity: "Family activity",
  } satisfies Record<NotificationStream, string>,
  frequencyEveryItem: "Every item",
  frequencyOff: "Off",
  streamFrequencyAria: (streamLabel: string) => `${streamLabel} frequency`,
} as const;
