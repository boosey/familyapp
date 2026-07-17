"use client";

import Link from "next/link";
import { PROTO_FAMILY, PROTO_STORIES } from "../mock-data";

const stage = "#0C1218";
const ink = "#E8EEF5";
const dim = "#8A9BB0";
const accent = "#7EB6FF";
const line = "#243041";

/** Voice Theater — sparse program hub; stages for tell/listen. */
export function VoiceTheaterHub() {
  return (
    <main style={{ minHeight: "100dvh", background: stage, color: ink }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 18px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/dev/prototypes"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: dim,
              textDecoration: "none",
            }}
          >
            ← Prototypes
          </Link>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: accent,
              border: `1px solid ${accent}`,
              padding: "4px 8px",
            }}
          >
            Voice Theater
          </span>
        </div>

        <p
          style={{
            margin: "36px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: dim,
          }}
        >
          Tonight&apos;s program · {PROTO_FAMILY}
        </p>
        <h1
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-story)",
            fontSize: "clamp(2.4rem, 6vw, 3.4rem)",
            fontWeight: 500,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          Voices
        </h1>

        <Link
          href="/dev/prototypes/voice-theater/tell"
          style={{
            display: "block",
            marginTop: 28,
            padding: "22px 20px",
            border: `2px solid ${accent}`,
            color: ink,
            textDecoration: "none",
            fontFamily: "var(--font-ui)",
            fontSize: "1.2rem",
            fontWeight: 600,
          }}
        >
          Take the stage → Tell a story
        </Link>

        <ol style={{ listStyle: "none", margin: "36px 0 0", padding: 0 }}>
          {PROTO_STORIES.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`/dev/prototypes/voice-theater/listen/${s.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "3rem 1fr auto",
                  gap: 14,
                  alignItems: "baseline",
                  padding: "18px 0",
                  borderTop: `1px solid ${line}`,
                  textDecoration: "none",
                  color: ink,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.85rem",
                    color: dim,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--font-story)",
                      fontSize: "1.35rem",
                      fontWeight: 500,
                      marginBottom: 4,
                    }}
                  >
                    {s.title}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      color: dim,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.narrator}
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.9rem",
                    color: accent,
                  }}
                >
                  {s.duration}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
