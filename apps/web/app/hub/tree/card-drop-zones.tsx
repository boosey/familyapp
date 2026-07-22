"use client";
/**
 * CardDropZones (#287) — top / bottom / side hit targets over a tree person card while a tray
 * place-drag is active. Side = partner only (left + right); no sibling zone.
 */
import type { DragEvent } from "react";
import { hub } from "@/app/_copy";
import type { PlaceZone } from "./place-confirm";
import styles from "./card-drop-zones.module.css";

export interface CardDropZonesProps {
  personId: string;
  onZoneDrop: (zone: PlaceZone) => void;
  /** True while a place-drag MIME is over this card (highlight). */
  active?: boolean;
  onDragEnterCard?: (e: DragEvent) => void;
  onDragOverCard?: (e: DragEvent) => void;
  onDragLeaveCard?: (e: DragEvent) => void;
}

const ZONES: { zone: PlaceZone; side: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { zone: "top", side: "top", label: hub.tree.zoneParent },
  { zone: "bottom", side: "bottom", label: hub.tree.zoneChild },
  { zone: "side", side: "left", label: hub.tree.zonePartner },
  { zone: "side", side: "right", label: hub.tree.zonePartner },
];

export function CardDropZones({
  personId,
  onZoneDrop,
  active = false,
  onDragEnterCard,
  onDragOverCard,
  onDragLeaveCard,
}: CardDropZonesProps) {
  return (
    <div
      className={`${styles.root}${active ? ` ${styles.rootActive}` : ""}`}
      data-testid={`card-drop-zones-${personId}`}
      data-active={active ? "true" : undefined}
      onDragEnter={onDragEnterCard}
      onDragOver={onDragOverCard}
      onDragLeave={onDragLeaveCard}
    >
      {ZONES.map(({ zone, side, label }) => (
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
            onZoneDrop(zone);
          }}
        >
          <span className={styles.label}>{label}</span>
        </div>
      ))}
    </div>
  );
}
