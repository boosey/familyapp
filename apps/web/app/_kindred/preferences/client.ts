/**
 * Client-side preference I/O — the thin browser wrappers over the pure registry logic. These are the
 * only pieces that touch `window`/`document`; all validation and applied-value computation lives in
 * `registry.ts` and is shared with the pre-paint script.
 */
import { coerce, computeApplication, type PreferenceDef } from "./registry";

/** The current value of a preference: the validated stored value, or the declared default. */
export function readPreference(def: PreferenceDef): string | number {
  let raw: string | null = null;
  if (typeof window !== "undefined") {
    // `localStorage` can throw a SecurityError when it is disabled or blocked (private browsing,
    // strict privacy settings); treat that as "nothing stored" and fall back to the default.
    try {
      raw = window.localStorage.getItem(def.storageKey);
    } catch {
      raw = null;
    }
  }
  return coerce(def, raw);
}

/** Apply a preference value to the document (idempotent; safe to call on mount and on change). */
export function applyPreference(
  def: PreferenceDef,
  value: string | number,
  el?: HTMLElement,
): void {
  // SSR-safe: never reach for `document` when there is no DOM (the default target is resolved here,
  // not as a default parameter, so it isn't evaluated in a non-browser context).
  if (typeof document === "undefined") return;
  const target = el ?? document.documentElement;
  const app = computeApplication(def, value);
  if (app.target === "root-font-size") target.style.fontSize = app.value;
  else if (app.target === "data-attr") target.setAttribute(app.attr, app.value);
  else if (app.target === "css-var") target.style.setProperty(app.name, app.value);
  // js-read: no DOM mutation — consumers read via readPreference.
}

/** Persist a preference and apply it — the write path a control calls when the user chooses. */
export function setPreference(def: PreferenceDef, value: string | number): void {
  if (typeof window !== "undefined") {
    // A blocked/full `localStorage` must not crash the write — apply the value regardless so the
    // choice still takes effect for this session even when it can't be persisted.
    try {
      window.localStorage.setItem(def.storageKey, String(value));
    } catch {
      /* ignore — persistence unavailable (SecurityError / quota); still apply below */
    }
  }
  applyPreference(def, value);
}
