/** Recording-gesture preference: how the mic starts/stops (tap-to-toggle vs hold-to-record). */
export const RECORDING_GESTURE_VALUES = ["tap", "hold"] as const;
export type RecordingGestureValue = (typeof RECORDING_GESTURE_VALUES)[number];
export const DEFAULT_RECORDING_GESTURE: RecordingGestureValue = "tap";
export const RECORDING_GESTURE_PHONE_STORAGE_KEY = "kin-recording-gesture-phone";
export const RECORDING_GESTURE_DESKTOP_STORAGE_KEY = "kin-recording-gesture-desktop";
