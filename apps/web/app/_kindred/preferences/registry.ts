/**
 * App-preference registry (ADR-0020). The single source of truth for the small, opt-in set of
 * device-local preferences a Person can set (today: reading size and color palette). Each preference
 * is PURE SERIALIZABLE DATA — no functions — so one definition drives the pre-paint inline script (which
 * cannot import TS), the React control, and validation, without any of them re-implementing the others.
 *
 * A UI value becomes a preference only by being registered here (opt-in); everything else stays a
 * compile-time constant changed by redeploy. JS-math values (e.g. tree geometry) are NOT preferences —
 * see ADR-0020 for the boundary and the additive `js-read` escape hatch.
 */
import {
  FONT_SIZE_STEPS_PT,
  DEFAULT_FONT_SIZE_INDEX,
} from "@/lib/constants";
import { FONT_SIZE_STORAGE_KEY } from "@/app/_kindred/font-scale-constants";
import { THEME_IDS, DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@/app/_kindred/theme-constants";

export type PreferenceValidator =
  | { kind: "int-index"; length: number }
  | { kind: "enum"; values: readonly string[] };

export type PreferenceApply =
  | { strategy: "root-font-size"; steps: readonly number[]; unit: string }
  | { strategy: "data-attr"; attr: string }
  | { strategy: "css-var"; cssVar: string; unit?: string };

export interface PreferenceDef {
  /** Stable identifier for the preference. */
  key: string;
  /** localStorage key its value is stored under (may predate this registry). */
  storageKey: string;
  /** Value used when nothing valid is stored. */
  default: string | number;
  validate: PreferenceValidator;
  apply: PreferenceApply;
}

/**
 * Coerce a raw stored string (or null when absent) to a valid preference value, falling back to the
 * declared default. This is the single validation authority shared by the pre-paint script and React.
 *
 * NOTE (ADR-0020, deliberate deviation): absent/blank storage falls back to `default`. The previous
 * hand-rolled code read the font index via `Number(localStorage.getItem(key))`, and `Number(null) === 0`
 * silently defeated `DEFAULT_FONT_SIZE_INDEX = 1`, so new users got the smallest size. This restores the
 * declared default for the missing-key case.
 */
export function coerce(def: PreferenceDef, raw: string | null): string | number {
  if (raw === null || raw === "") return def.default;
  const v = def.validate;
  if (v.kind === "int-index") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < v.length ? n : def.default;
  }
  // enum
  return v.values.includes(raw) ? raw : def.default;
}

/**
 * What actually gets written to apply a preference, computed purely (no DOM). The thin client wrapper
 * turns this into a `documentElement` mutation; the pre-paint script computes the equivalent inline.
 */
export type PreferenceApplication =
  | { target: "root-font-size"; value: string }
  | { target: "data-attr"; attr: string; value: string }
  | { target: "css-var"; name: string; value: string };

export function computeApplication(def: PreferenceDef, value: string | number): PreferenceApplication {
  const a = def.apply;
  if (a.strategy === "root-font-size") {
    const idx = typeof value === "number" ? value : Number(value);
    const pt = a.steps[idx] ?? a.steps[0] ?? 0;
    return { target: "root-font-size", value: `${pt}${a.unit}` };
  }
  if (a.strategy === "data-attr") {
    return { target: "data-attr", attr: a.attr, value: String(value) };
  }
  return { target: "css-var", name: a.cssVar, value: `${value}${a.unit ?? ""}` };
}

/**
 * The registry: the small, opt-in set of app preferences. Reading size and color palette are folded in
 * from their previously hand-rolled constants (ADR-0020). Adding a preference is adding an entry here.
 */
export const PREFERENCES = {
  readingSize: {
    key: "reading-size",
    storageKey: FONT_SIZE_STORAGE_KEY,
    default: DEFAULT_FONT_SIZE_INDEX,
    validate: { kind: "int-index", length: FONT_SIZE_STEPS_PT.length },
    apply: { strategy: "root-font-size", steps: FONT_SIZE_STEPS_PT, unit: "pt" },
  },
  theme: {
    key: "theme",
    storageKey: THEME_STORAGE_KEY,
    default: DEFAULT_THEME_ID,
    validate: { kind: "enum", values: THEME_IDS },
    apply: { strategy: "data-attr", attr: "data-theme" },
  },
} as const satisfies Record<string, PreferenceDef>;

/** All registered preferences as a list (for the pre-paint script and any registry-driven UI). */
export const ALL_PREFERENCES: readonly PreferenceDef[] = Object.values(PREFERENCES);

/**
 * Build the blocking, pre-paint inline script that applies stored preferences to <html> before first
 * paint (no FOUC). It is DATA-DRIVEN: the registry is serialized and a small generic runtime coerces +
 * applies each entry, so adding a preference needs no edit here. The coerce/apply logic is necessarily
 * re-expressed in vanilla JS (the inline script cannot import TS) — its agreement with `coerce` /
 * `computeApplication` is locked by a drift-guard test that executes this script and compares.
 */
export function buildPrePaintScript(defs: readonly PreferenceDef[]): string {
  const data = JSON.stringify(defs);
  return `(function(){try{var D=${data};for(var i=0;i<D.length;i++){var d=D[i];var raw=localStorage.getItem(d.storageKey);var v=d.validate,val;if(raw===null||raw===""){val=d.default;}else if(v.kind==="int-index"){var n=Number(raw);val=(Number.isInteger(n)&&n>=0&&n<v.length)?n:d.default;}else{val=v.values.indexOf(raw)>=0?raw:d.default;}var a=d.apply,el=document.documentElement;if(a.strategy==="root-font-size"){var pt=a.steps[val];if(pt==null)pt=a.steps[0];if(pt==null)pt=0;el.style.fontSize=pt+a.unit;}else if(a.strategy==="data-attr"){el.setAttribute(a.attr,String(val));}else{el.style.setProperty(a.cssVar,String(val)+(a.unit||""));}}}catch(e){}})()`;
}
