"use client";

import { useState, type CSSProperties } from "react";

/** Copy-to-clipboard button for the one-time invite link. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const btn: CSSProperties = {
    padding: "12px 20px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: copied ? "var(--support)" : "var(--accent)",
    color: "var(--accent-on)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
    transition: "background var(--dur-fade) var(--ease-quiet)",
  };

  return (
    <button type="button" onClick={copy} style={btn}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}
