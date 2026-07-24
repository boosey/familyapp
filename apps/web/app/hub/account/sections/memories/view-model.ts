/**
 * Account › Memories — the VIEW MODEL (ADR-0029 §#357). The load-bearing seam of this section.
 *
 * `MemoryItem` is shaped after the future append-only `narrator_memory` ledger row (title / summary /
 * tags / origin / sourceStoryId / status) so that the card UI renders against the SAME shape it will
 * consume once the ledger ships (#362). Swapping the data source is then a data-layer change in the
 * server component (`index.tsx`) — map ledger rows to `MemoryItem` instead of anchors — and NOT a UI
 * rewrite.
 *
 * DAY-1 the items are mapped from `persons.biographical_anchors`. The anchor-only fields (`kind`,
 * `key`, `rawText`/`rawBool`, `placeholder`, `isSet`) drive inline editing and tell each card which
 * server action to call. When the ledger lands, `kind: "text"` items become `origin`-carrying memory
 * rows with a real `sourceStoryId`; these anchor fields fall away.
 *
 * Note: `MemoryItem` is passed from a server component to a client component, so it must be a plain
 * serializable object — NO functions. Value formatting lives in the exported `formatText`/`formatBool`
 * helpers the client imports directly.
 */
import type { BiographicalProfile } from "@chronicle/db";
import { memoryLabels } from "./copy";

/** Which future ledger `origin` a memory carries. Anchor-backed memories are all user/profile facts. */
export type MemoryOrigin = "user" | "extracted";

/** Whether the card edits a free-text anchor or a yes/no anchor. Falls away in the ledger era. */
export type MemoryKind = "text" | "bool";

/**
 * A single memory as rendered by the card list. Mirrors the `narrator_memory` ledger contract; the
 * `kind`/`key`/`raw*`/`placeholder` fields are the day-1 anchor affordance.
 */
export interface MemoryItem {
  /** Stable id. Today this is the anchor key; in the ledger era it's the memory row id. */
  id: string;
  /** The anchor key the card's server action writes. Same as `id` today. */
  key: string;
  /** Human title (ledger `title`). */
  title: string;
  /** Rendered value line (ledger `summary`), or null when the memory isn't set. */
  summary: string | null;
  /** Ledger `origin` — day-1 anchors are all user-stated profile facts. */
  origin: MemoryOrigin;
  /**
   * Ledger `sourceStoryId` — the story this memory was drawn from. ALWAYS null in the anchor era
   * (anchors have no source story); the UI reads this to decide whether to show story provenance.
   */
  sourceStoryId: string | null;
  /** Ledger `tags`. Empty for anchors. */
  tags: readonly string[];
  /** Whether a value is currently held. */
  isSet: boolean;

  /** Editing affordance — anchor era only. */
  kind: MemoryKind;
  /** Current raw text value for a `kind: "text"` memory (null when unset). */
  rawText: string | null;
  /** Current raw boolean value for a `kind: "bool"` memory (null when unset). */
  rawBool: boolean | null;
  /** Placeholder shown in the text edit field. */
  placeholder: string;
}

/** Render a text anchor's stored value as its summary line. */
export function formatText(value: string): string {
  return value;
}

/** Render a yes/no anchor's stored value as its summary line. */
export function formatBool(value: boolean): string {
  return value ? "Yes" : "No";
}

interface TextSpec {
  key: "hometown" | "siblingContext" | "currentLocation" | "occupationSummary";
  placeholder: string;
}

const TEXT_SPECS: readonly TextSpec[] = [
  { key: "hometown", placeholder: "e.g. New Orleans, Louisiana" },
  { key: "siblingContext", placeholder: "e.g. The oldest of four" },
  { key: "currentLocation", placeholder: "e.g. Austin, Texas" },
  { key: "occupationSummary", placeholder: "e.g. A high-school teacher for 30 years" },
];

const BOOL_KEYS = ["hasChildren", "hasGrandchildren"] as const;

/**
 * Map the stored biographical anchors into the memory view model. THIS is the swap point: when the
 * `narrator_memory` ledger ships (#362), replace this function's body with one that maps ledger rows
 * (status = active) to `MemoryItem` — the card list stays exactly as-is.
 */
export function anchorsToMemoryItems(anchors: Partial<BiographicalProfile>): MemoryItem[] {
  const items: MemoryItem[] = [];

  for (const spec of TEXT_SPECS) {
    const raw = anchors[spec.key] ?? null;
    items.push({
      id: spec.key,
      key: spec.key,
      title: memoryLabels[spec.key],
      summary: raw ? formatText(raw) : null,
      origin: "user",
      sourceStoryId: null,
      tags: [],
      isSet: raw !== null && raw !== "",
      kind: "text",
      rawText: raw,
      rawBool: null,
      placeholder: spec.placeholder,
    });
  }

  // hasGrandchildren is only meaningful when hasChildren is true — hide it otherwise, matching the
  // profile editor's dependent-field behavior.
  const hasChildren = anchors.hasChildren ?? null;
  for (const key of BOOL_KEYS) {
    if (key === "hasGrandchildren" && hasChildren !== true) continue;
    const raw = anchors[key] ?? null;
    items.push({
      id: key,
      key,
      title: memoryLabels[key],
      summary: raw === null ? null : formatBool(raw),
      origin: "user",
      sourceStoryId: null,
      tags: [],
      isSet: raw !== null,
      kind: "bool",
      rawText: null,
      rawBool: raw,
      placeholder: "",
    });
  }

  return items;
}
