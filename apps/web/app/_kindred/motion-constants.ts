/** Reduce-motion preference. `on` writes `data-reduce-motion="on"` on <html>; the CSS guard keys off it. */
export const REDUCE_MOTION_VALUES = ["on", "off"] as const;
export type ReduceMotionValue = (typeof REDUCE_MOTION_VALUES)[number];
export const DEFAULT_REDUCE_MOTION: ReduceMotionValue = "off";
export const MOTION_STORAGE_KEY = "kin-reduce-motion";
