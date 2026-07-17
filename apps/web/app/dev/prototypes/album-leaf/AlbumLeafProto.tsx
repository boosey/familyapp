"use client";

import Link from "next/link";
import { useState } from "react";
import { PROTO_FAMILY, PROTO_STORIES, PROTO_TABS } from "../mock-data";

const ink = "#121816";
const page = "#F0F3F1";
const card = "#FFFFFF";
const line = "#B8C4BE";
const accent = "#0E5C52";
const muted = "#5A6A64";

/** Album Leaf — photo-first rows, hard borders, underline tabs. */
export function AlbumLeafProto() {
  const [tab, setTab] = useState<(typeof PROTO_TABS)[number]["key"]>("stories");

  return (
    <main style={{ minHeight: "100dvh", background: page, color: ink }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 18px 64px" }}>
        <ProtoChrome name="Album Leaf" accent={accent} />

        <header style={{ marginTop: 28, marginBottom: 8 }}>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: muted,
            }}
          >
            Family Chronicle
          </p>
          <h1
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-story)",
              fontSize: "clamp(2.2rem, 5vw, 3rem)",
              fontWeight: 500,
              letterSpacing: "-0.025em",
            }}
          >
            {PROTO_FAMILY}
          </h1>
        </header>

        <nav
          aria-label="Sections"
          style={{
            display: "flex",
            borderBottom: `2px solid ${line}`,
            marginBottom: 28,
            overflowX: "auto",
          }}
        >
          {PROTO_TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  appearance: "none",
                  background: "none",
                  border: "none",
                  borderBottom: on ? `3px solid ${accent}` : "3px solid transparent",
                  marginBottom: -2,
                  padding: "14px 16px",
                  fontFamily: "var(--font-ui)",
                  fontSize: "1.1rem",
                  fontWeight: on ? 600 : 500,
                  color: on ? ink : muted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === "stories" && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {PROTO_STORIES.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dev/prototypes/album-leaf/${s.id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr auto",
                    textDecoration: "none",
                    color: ink,
                    background: card,
                    border: `2px solid ${line}`,
                    borderRadius: 6,
                    overflow: "hidden",
                    minHeight: 120,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      background: toneFill(s.tone),
                      borderRight: `2px solid ${line}`,
                      display: "flex",
                      alignItems: "flex-end",
                      padding: 10,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      letterSpacing: "0.04em",
                      color: accent,
                      textTransform: "uppercase",
                    }}
                  >
                    photo
                  </span>
                  <span style={{ padding: "14px 16px", minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8rem",
                        color: muted,
                        marginBottom: 6,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {s.narrator} · {s.year} · {s.place}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-story)",
                        fontSize: "1.35rem",
                        fontWeight: 500,
                        lineHeight: 1.25,
                        marginBottom: 6,
                      }}
                    >
                      {s.title}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-ui)",
                        fontSize: "1rem",
                        color: muted,
                        lineHeight: 1.45,
                      }}
                    >
                      {s.excerpt}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    style={{
                      alignSelf: "center",
                      padding: "0 16px",
                      color: accent,
                      fontSize: 24,
                    }}
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {tab === "album" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
            }}
          >
            {PROTO_STORIES.map((s) => (
              <Link
                key={s.id}
                href={`/dev/prototypes/album-leaf/${s.id}`}
                style={{
                  aspectRatio: "1",
                  background: toneFill(s.tone),
                  border: `2px solid ${line}`,
                  borderRadius: 6,
                  textDecoration: "none",
                  color: ink,
                  padding: 12,
                  display: "flex",
                  alignItems: "flex-end",
                  fontFamily: "var(--font-story)",
                  fontSize: "1rem",
                  lineHeight: 1.2,
                }}
              >
                {s.narrator}
              </Link>
            ))}
          </div>
        )}

        {tab === "family" && (
          <div style={{ border: `2px solid ${line}`, background: card, borderRadius: 6, padding: 24 }}>
            <p style={{ margin: 0, fontFamily: "var(--font-story)", fontSize: "1.5rem" }}>
              Eleanor · Sofia · Marcus
            </p>
            <p style={{ margin: "10px 0 0", fontFamily: "var(--font-ui)", color: muted }}>
              Flat list for the prototype — tree lives in the real Family tab.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function ProtoChrome({ name, accent }: { name: string; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <Link
        href="/dev/prototypes"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.8rem",
          letterSpacing: "0.05em",
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
          borderRadius: 4,
        }}
      >
        {name}
      </span>
    </div>
  );
}

function toneFill(tone: "warm" | "cool" | "deep"): string {
  if (tone === "warm") return "#D7EBE7";
  if (tone === "cool") return "#D9E4F2";
  return "#E4EDD4";
}

export { ProtoChrome, toneFill, ink, page, card, line, accent, muted };
