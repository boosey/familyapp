"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { setStoryFavoriteAction } from "./actions";
import type { FavoriteState } from "@chronicle/core";

export interface FavoriteButtonProps {
  storyId: string;
  initialState: FavoriteState;
  canFavorite: boolean;
}

export function FavoriteButton({ storyId, initialState, canFavorite }: FavoriteButtonProps) {
  const [state, setState] = useState<FavoriteState>(initialState);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    if (!canFavorite || isPending) return;

    // Optimistic update
    const nextFavorited = !state.favoritedByViewer;
    const nextCount = state.count + (nextFavorited ? 1 : -1);
    
    setState({
      favoritedByViewer: nextFavorited,
      count: Math.max(0, nextCount),
    });

    startTransition(async () => {
      const res = await setStoryFavoriteAction(storyId, nextFavorited);
      if (res.error || !res.state) {
        // Revert on error
        setState(initialState);
      } else {
        setState(res.state);
      }
    });
  };

  const buttonStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm, 1.125rem)",
    fontWeight: 600,
    background: "transparent",
    border: "1.5px solid var(--border)",
    borderRadius: "var(--radius-pill, 9999px)",
    padding: "6px 16px",
    color: state.favoritedByViewer ? "var(--accent-strong)" : "var(--text-muted)",
    cursor: canFavorite ? "pointer" : "default",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    outline: "none",
  };

  const activeHoverStyle = canFavorite ? {
    background: "var(--accent-soft)",
    borderColor: "var(--accent)",
  } : {};

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={!canFavorite || isPending}
      style={{
        ...buttonStyle,
        ...(canFavorite && !isPending ? activeHoverStyle : {}),
      }}
      aria-label={state.favoritedByViewer ? "Remove bookmark" : "Bookmark story"}
    >
      <span style={{ fontSize: "1.25rem" }}>
        {state.favoritedByViewer ? "♥" : "♡"}
      </span>
      <span>
        {state.count}
      </span>
    </button>
  );
}
