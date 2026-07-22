"use client";
/**
 * CardDropZones (#287 / #288) — top / bottom / side hit targets over a tree person card.
 *
 *   - mode="drop": tray place-drag (#287) — HTML5 drop targets.
 *   - mode="tap": mobile Place→tap→zone (#288) — buttons; pointer events stop so pan doesn't steal taps.
 *
 * Side = partner only (left + right); no sibling zone. Both modes share {@link relationFromZone}
 * via the caller (zoneDropModalProps / onPlaceZoneChosen).
 */
import type { DragEvent, SyntheticEvent } from "react";
import { hub } from "@/app/_copy";
import type { PlaceZone } from "./place-confirm";
import styles from "./card-drop-zones.module.css";

export interface CardDropZonesProps {
  personId: string;
  /** "drop" = tray DnD (#287); "tap" = mobile Place→zone (#288). Defaults to drop. */
  mode?: "drop" | "tap";
  onZoneDrop?: (zone: PlaceZone) => void;
  onZoneChoose?: (zone: PlaceZone) => void;
  /** True while a place-drag MIME is over this card (highlight). Drop mode only. */
  active?: boolean;
  onDragEnterCard?: (e: DragEvent) => void;
  onDragOverCard?: (e: DragEvent) => void;
  onDragLeaveCard?: (e: DragEvent) => void;
}

const DROP_ZONES: { zone: PlaceZone; side: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { zone: "top", side: "top", label: hub.tree.zoneParent },
  { zone: "bottom", side: "bottom", label: hub.tree.zoneChild },
  { zone: "side", side: "left", label: hub.tree.zonePartner },
  { zone: "side", side: "right", label: hub.tree.zonePartner },
];

const TAP_ZONES: {
  zone: PlaceZone;
  side: "top" | "bottom" | "left" | "right";
  label: string;
  testId: string;
}[] = [
  { zone: "top", side: "top", label: hub.tree.placeZoneParent, testId: "place-zone-top" },
  { zone: "side", side: "left", label: hub.tree.placeZonePartner, testId: "place-zone-side-left" },
  { zone: "side", side: "right", label: hub.tree.placeZonePartner, testId: "place-zone-side-right" },
  { zone: "bottom", side: "bottom", label: hub.tree.placeZoneChild, testId: "place-zone-bottom" },
];

export function CardDropZones({
  personId,
  mode = "drop",
  onZoneDrop,
  onZoneChoose,
  active = false,
  onDragEnterCard,
  onDragOverCard,
  onDragLeaveCard,
}: CardDropZonesProps) {
  if (mode === "tap") {
    const stop = (e: SyntheticEvent) => {
      e.stopPropagation();
    };
    return (
      <div
        className={`${styles.root} ${styles.rootTap}`}
        data-testid={`place-zones-${personId}`}
        role="group"
        aria-label={hub.tree.placeZonesAria}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onClick={stop}
      >
        {TAP_ZONES.map(({ zone, side, label, testId }) => (
          <button
            key={side}
            type="button"
            className={`${styles.zone} ${styles.zoneTap} ${styles[side]}`}
            data-testid={testId}
            data-zone={zone}
            aria-label={label}
            onClick={(e) => {
              stop(e);
              onZoneChoose?.(zone);
            }}
          >
            <span className={styles.label}>{label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`${styles.root}${active ? ` ${styles.rootActive}` : ""}`}
      data-testid={`card-drop-zones-${personId}`}
      data-active={active ? "true" : undefined}
      onDragEnter={onDragEnterCard}
      onDragOver={onDragOverCard}
      onDragLeave={onDragLeaveCard}
    >
      {DROP_ZONES.map(({ zone, side, label }) => (
        <div
          key={side}
          role="button"
          tabIndex={-1}
          aria-label={label}
          data-testid={`card-drop-zone-${personId}-${side}`}
          data-zone={zone}
          className={`${styles.zone} ${styles[side]}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            onDragOverCard?.(e);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onZoneDrop?.(zone);
          }}
        >
          <span className={styles.label}>{label}</span>
        </div>
      ))}
    </div>
  );
}
