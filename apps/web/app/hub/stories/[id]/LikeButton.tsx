"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { setStoryLikeAction } from "./actions";
import type { LikeState } from "@chronicle/core";

export interface LikeButtonProps {
  storyId: string;
  initialState: LikeState;
  canLike: boolean;
}

export function LikeButton({ storyId, initialState, canLike }: LikeButtonProps) {
  const [state, setState] = useState<LikeState>(initialState);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    if (!canLike || isPending) return;

    // Optimistic update
    const nextLiked = !state.likedByViewer;
    const nextCount = state.count + (nextLiked ? 1 : -1);

    setState((prev) => ({
      ...prev,
      likedByViewer: nextLiked,
      count: Math.max(0, nextCount),
    }));

    startTransition(async () => {
      const res = await setStoryLikeAction(storyId, nextLiked);
      if (res.error || !res.state) {
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
    color: state.likedByViewer ? "var(--accent-strong)" : "var(--text-muted)",
    cursor: canLike ? "pointer" : "default",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    outline: "none",
  };

  const activeHoverStyle = canLike ? {
    background: "var(--accent-soft)",
    borderColor: "var(--accent)",
  } : {};

  // Render initials avatar helper
  const initialsOf = (name: string) => {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  };

  const maxAvatars = 5;
  const visibleLikers = state.likers.slice(0, maxAvatars);
  const overflowCount = state.count - visibleLikers.length;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canLike || isPending}
        style={{
          ...buttonStyle,
          ...(canLike && !isPending ? activeHoverStyle : {}),
        }}
        aria-label={state.likedByViewer ? "Unlike story" : "Like story"}
      >
        <span style={{ fontSize: "1.1rem" }}>
          👍
        </span>
        <span>
          {state.count}
        </span>
      </button>

      {/* Liker avatars (only shown when user can like and there are likers to display) */}
      {canLike && state.likers.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {visibleLikers.map((liker) => (
            <span
              key={liker.personId}
              title={liker.displayName}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--border)",
                color: "var(--text-body)",
                fontFamily: "var(--font-ui)",
                fontSize: "0.75rem",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid var(--surface-card)",
              }}
            >
              {initialsOf(liker.displayName)}
            </span>
          ))}

          {overflowCount > 0 && (
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                marginLeft: 4,
              }}
            >
              +{overflowCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
