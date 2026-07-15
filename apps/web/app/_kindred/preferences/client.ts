/**
 * Client-side preference I/O — the thin browser wrappers over the pure registry logic. These are the
 * only pieces that touch `window`/`document`; all validation and applied-value computation lives in
 * `registry.ts` and is shared with the pre-paint script.
 */
import { coerce, computeApplication, type PreferenceDef } from "./registry";

/** The current value of a preference: the validated stored value, or the declared default. */
export function readPreference(def: PreferenceDef): string | number {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(def.storageKey);
  return coerce(def, raw);
}

/** Apply a preference value to the document (idempotent; safe to call on mount and on change). */
export function applyPreference(
  def: PreferenceDef,
  value: string | number,
  el: HTMLElement = document.documentElement,
): void {
  const app = computeApplication(def, value);
  if (app.target === "root-font-size") el.style.fontSize = app.value;
  else if (app.target === "data-attr") el.setAttribute(app.attr, app.value);
  else el.style.setProperty(app.name, app.value);
}

/** Persist a preference and apply it — the write path a control calls when the user chooses. */
export function setPreference(def: PreferenceDef, value: string | number): void {
  window.localStorage.setItem(def.storageKey, String(value));
  applyPreference(def, value);
}
