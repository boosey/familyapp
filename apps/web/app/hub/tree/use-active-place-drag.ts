"use client";
/**
 * useActivePlaceDrag (#287) — subscribe TreeCanvas to tray place-drag start/end.
 */
import { useSyncExternalStore } from "react";
import {
  getActivePlaceDrag,
  subscribeActivePlaceDrag,
  type PlaceDragPayload,
} from "./place-drag";

export function useActivePlaceDrag(): PlaceDragPayload | null {
  return useSyncExternalStore(subscribeActivePlaceDrag, getActivePlaceDrag, () => null);
}
