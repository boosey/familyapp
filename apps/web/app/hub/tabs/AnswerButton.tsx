"use client";

import { useState, type CSSProperties } from "react";

/**
 * "Answer" affordance for a pending question. Recording does not yet live inside the hub — the
 * elder records on their personal /s/<token> surface — so rather than a button that silently does
 * nothing, this reveals an honest inline note on tap.
 */
export function AnswerButton() {
  const [shown, setShown] = useState(false);

  const btn: CSSProperties = {
    padding: "12px 22px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-on)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <button type="button" onClick={() => setShown((s) => !s)} style={btn}>
        <span aria-hidden="true">🎙</span> Answer
      </button>
      {shown ? (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            color: "var(--text-muted)",
            maxWidth: 240,
            textAlign: "right",
          }}
        >
          Recording lives on your personal link for now — in-hub recording is coming soon.
        </span>
      ) : null}
    </div>
  );
}
