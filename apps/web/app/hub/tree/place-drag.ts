/**
 * Desktop tray → card-zone DnD (#287 / ADR-0027) — drag payload MIME + a tiny active-drag store
 * so TreeCanvas can show zone overlays while UnplacedMembers owns the drag source.
 *
 * Drop always opens PlaceConfirmModal with `receiverLocked` + `initialRelation` from
 * {@link relationFromZone}; writes stay on commitPlaceLink / commitPlaceMint (no duplicate path).
 */
import type { AddRelativeRelation } from "@chronicle/core";
import {
  relationFromZone,
  type PlaceConfirmSubject,
  type PlaceZone,
} from "./place-confirm";

/** Custom MIME so we never confuse a tray place-drag with text/plain scrapes or other DnD. */
export const PLACE_DRAG_MIME = "application/x-chronicle-place";

export type PlaceDragPayload =
  | {
      kind: "link";
      personId: string;
      displayName: string | null;
    }
  | {
      kind: "mint";
    };

export function encodePlaceDrag(payload: PlaceDragPayload): string {
  return JSON.stringify(payload);
}

export function parsePlaceDragData(raw: string): PlaceDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind === "mint") return { kind: "mint" };
    if (kind === "link") {
      const personId = (parsed as { personId?: unknown }).personId;
      if (typeof personId !== "string" || personId.length === 0) return null;
      const displayName = (parsed as { displayName?: unknown }).displayName;
      return {
        kind: "link",
        personId,
        displayName: typeof displayName === "string" ? displayName : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read our MIME from a DataTransfer (dragover / drop). Returns null when absent or malformed. */
export function readPlaceDrag(dt: DataTransfer | null | undefined): PlaceDragPayload | null {
  if (!dt) return null;
  // `types` is the reliable signal on dragover (getData is often empty until drop in some browsers).
  if (![...dt.types].includes(PLACE_DRAG_MIME)) return null;
  const raw = dt.getData(PLACE_DRAG_MIME);
  if (!raw) {
    // dragover: payload may be opaque — treat presence of the MIME as "a place drag".
    return getActivePlaceDrag();
  }
  return parsePlaceDragData(raw);
}

export function writePlaceDrag(dt: DataTransfer, payload: PlaceDragPayload): void {
  const encoded = encodePlaceDrag(payload);
  dt.setData(PLACE_DRAG_MIME, encoded);
  // Fallback for environments that only expose text/plain in types during dragover.
  dt.setData("text/plain", encoded);
  dt.effectAllowed = "copyMove";
}

export function subjectFromPlaceDrag(payload: PlaceDragPayload): PlaceConfirmSubject {
  if (payload.kind === "mint") return { kind: "mint" };
  return {
    kind: "link",
    personId: payload.personId,
    displayName: payload.displayName,
  };
}

/**
 * Thin seam for tests + callers: zone drop → modal props (locked receiver + relation from zone).
 * Side → partner only; no sibling zone.
 */
export function zoneDropModalProps(
  zone: PlaceZone,
  receiver: { personId: string; displayName: string },
  subject: PlaceConfirmSubject,
): {
  subject: PlaceConfirmSubject;
  receiver: { personId: string; displayName: string };
  receiverLocked: true;
  initialRelation: AddRelativeRelation;
} {
  return {
    subject,
    receiver,
    receiverLocked: true,
    initialRelation: relationFromZone(zone),
  };
}

// --- Active-drag store (tray dragstart ↔ canvas overlays) ---------------------------------

type Listener = () => void;

let activePlaceDrag: PlaceDragPayload | null = null;
const listeners = new Set<Listener>();

export function getActivePlaceDrag(): PlaceDragPayload | null {
  return activePlaceDrag;
}

export function setActivePlaceDrag(payload: PlaceDragPayload | null): void {
  activePlaceDrag = payload;
  for (const l of listeners) l();
}

export function subscribeActivePlaceDrag(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
