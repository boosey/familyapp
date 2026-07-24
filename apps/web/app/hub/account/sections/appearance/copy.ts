/**
 * Account › Appearance — section-specific copy (ADR-0029). These are the section-panel headings and
 * intros for the DEVICE-LOCAL app preferences (ADR-0020) relocated from /hub/settings. The Kindred
 * picker controls (KindredSkinPicker, …) read their own option labels from the
 * shared `hub.settings` copy; this file only owns the per-control heading/intro copy the panel renders.
 */
export const appearanceCopy = {
  skinHeading: "Look and feel",
  skinIntro: "Choose how the app looks and feels on this device.",
  motionHeading: "Reduce motion",
  motionIntro: "Turn off gentle animations and movement across the app.",
  recordingGestureHeading: "Recording gesture",
  recordingGestureIntro:
    "Choose how the microphone button starts and stops recording — separately for phone and desktop on this device.",
  textSizeHeading: "Text size",
  textSizeIntro: "Makes everything on the screen a little larger or smaller.",
} as const;
