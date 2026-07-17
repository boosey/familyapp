"use client";

import Link from "next/link";
import { useState } from "react";

const stage = "#0C1218";
const ink = "#E8EEF5";
const dim = "#8A9BB0";
const accent = "#7EB6FF";

/** Full-bleed tell stage — one question, one mic action. */
export function TellStage() {
  const [listening, setListening] = useState(false);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: stage,
        color: ink,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "20px 18px", display: "flex", justifyContent: "space-between" }}>
        <Link
          href="/dev/prototypes/voice-theater"
          style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: dim, textDecoration: "none" }}
        >
          ← Program
        </Link>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: accent, letterSpacing: "0.08em" }}>
          STAGE
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "24px clamp(18px, 5vw, 48px) 48px",
          maxWidth: 720,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: dim,
          }}
        >
          A question for you
        </p>
        <h1
          style={{
            margin: "16px 0 0",
            fontFamily: "var(--font-story)",
            fontSize: "clamp(2rem, 5.5vw, 3rem)",
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          What sound still means home to you?
        </h1>

        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            onClick={() => setListening((v) => !v)}
            aria-pressed={listening}
            style={{
              width: 112,
              height: 112,
              borderRadius: "50%",
              border: `3px solid ${listening ? accent : ink}`,
              background: listening ? accent : "transparent",
              color: listening ? stage : ink,
              fontFamily: "var(--font-ui)",
              fontSize: "1.05rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: listening ? `0 0 0 12px rgba(126, 182, 255, 0.15)` : "none",
            }}
          >
            {listening ? "Stop" : "Speak"}
          </button>
          <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "0.9rem", color: dim }}>
            {listening ? "Listening… (mock)" : "Tap when you’re ready"}
          </p>
        </div>

        {listening && (
          <div
            aria-hidden
            style={{
              marginTop: 40,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: 5,
              height: 64,
            }}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 4,
                  height: `${18 + ((i * 17) % 46)}px`,
                  background: accent,
                  opacity: 0.35 + ((i * 13) % 50) / 100,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
