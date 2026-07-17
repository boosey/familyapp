"use client";

import Link from "next/link";
import { PROTO_FAMILY, PROTO_STORIES } from "../mock-data";

const pageBg = "#F4F5F0";
const ink = "#161912";
const muted = "#5C6552";
const line = "#B8C0A8";
const accent = "#3F6212";
const paper = "#FFFEFA";

/** Sunday Letter — dated letter stack, one column, one photo inset on open. */
export function SundayLetterHub() {
  return (
    <main style={{ minHeight: "100dvh", background: pageBg, color: ink }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/dev/prototypes"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              color: muted,
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
              border: `2px solid ${accent}`,
              padding: "4px 8px",
            }}
          >
            Sunday Letter
          </span>
        </div>

        <p
          style={{
            margin: "36px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: muted,
          }}
        >
          Letters from the {PROTO_FAMILY} family
        </p>
        <h1
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-story)",
            fontSize: "clamp(2.3rem, 5vw, 3.2rem)",
            fontWeight: 500,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
          }}
        >
          This week&apos;s mail
        </h1>

        <ul style={{ listStyle: "none", margin: "32px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {PROTO_STORIES.map((s) => (
            <li key={s.id}>
              <Link
                href={`/dev/prototypes/sunday-letter/${s.id}`}
                style={{
                  display: "block",
                  background: paper,
                  border: `2px solid ${line}`,
                  borderRadius: 4,
                  padding: "22px 22px 20px",
                  textDecoration: "none",
                  color: ink,
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                    letterSpacing: "0.05em",
                    color: muted,
                    marginBottom: 10,
                  }}
                >
                  {s.recorded} · from {s.narrator}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-story)",
                    fontSize: "1.55rem",
                    fontWeight: 500,
                    lineHeight: 1.2,
                    marginBottom: 10,
                  }}
                >
                  {s.title}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-ui)",
                    fontSize: "1.05rem",
                    color: muted,
                    lineHeight: 1.5,
                  }}
                >
                  Dear family — {s.excerpt}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/dev/prototypes/sunday-letter/kitchen-radio"
          style={{
            display: "inline-block",
            marginTop: 28,
            fontFamily: "var(--font-ui)",
            fontSize: "1.1rem",
            fontWeight: 600,
            color: accent,
            textDecoration: "none",
            borderBottom: `2px solid ${accent}`,
            paddingBottom: 2,
          }}
        >
          Write this week&apos;s letter →
        </Link>
      </div>
    </main>
  );
}
