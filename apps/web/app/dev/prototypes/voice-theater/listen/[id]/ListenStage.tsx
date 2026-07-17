"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProtoStory } from "../../../mock-data";

const stage = "#0C1218";
const ink = "#E8EEF5";
const dim = "#8A9BB0";
const accent = "#7EB6FF";

export function ListenStage({ story }: { story: ProtoStory }) {
  const [playing, setPlaying] = useState(false);

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
          LISTEN
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "24px clamp(18px, 5vw, 48px) 56px",
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
          {story.narrator} · {story.year}
        </p>
        <h1
          style={{
            margin: "12px 0 0",
            fontFamily: "var(--font-story)",
            fontSize: "clamp(1.9rem, 4.5vw, 2.7rem)",
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
          }}
        >
          {story.title}
        </h1>

        <div
          aria-hidden
          style={{
            marginTop: 40,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: 4,
            height: 88,
            opacity: playing ? 1 : 0.45,
          }}
        >
          {Array.from({ length: 36 }, (_, i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: `${12 + ((i * 23 + (playing ? 11 : 0)) % 72)}px`,
                background: accent,
              }}
            />
          ))}
        </div>

        <div style={{ marginTop: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            style={{
              minWidth: 160,
              minHeight: 56,
              padding: "0 28px",
              border: `2px solid ${accent}`,
              background: playing ? accent : "transparent",
              color: playing ? stage : ink,
              fontFamily: "var(--font-ui)",
              fontSize: "1.15rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <span style={{ fontFamily: "var(--font-mono)", color: dim }}>{story.duration}</span>
        </div>

        <p
          style={{
            margin: "40px 0 0",
            fontFamily: "var(--font-story)",
            fontSize: "1.25rem",
            lineHeight: 1.6,
            color: dim,
            fontStyle: "italic",
          }}
        >
          {story.excerpt}
        </p>
      </div>
    </main>
  );
}
