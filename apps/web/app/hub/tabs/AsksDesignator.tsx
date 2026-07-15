"use client";

/**
 * AsksDesignator — the client half of the Asks tab (ADR-0021, DESIGNATOR mode).
 *
 * The server (AsksTab) fetches ALL of the viewer's asks — every row already per-row authorized — plus
 * the viewer's full families list and a SEED family id derived from the current `?families=` filter.
 * This component holds the designated family in local state (seeded once), renders the shared
 * FamilyChips in single-select designator mode (only when the viewer has ≥2 families), and FILTERS the
 * already-authorized asks to the designated family CLIENT-SIDE. It never refetches and never writes the
 * URL — picking who you act on must not change what other tabs browse.
 *
 * FAMILY-LESS ASKS: an ask with no `ask_families` rows (older / self asks) carries `familyIds: []`.
 * Rather than hide it under every designator (a designator always resolves exactly one family, so a
 * family-less ask would otherwise never appear and silently vanish), we keep such asks visible under
 * EVERY designated family — they belong to the asker regardless of family context. See the filter below.
 */
import { useState } from "react";
import Link from "next/link";
import { FamilyChips } from "@/app/hub/FamilyChips";
import { hub } from "@/app/_copy";

export interface AsksDesignatorAsk {
  id: string;
  questionText: string;
  status: string;
  storyId: string | null;
  targetSpokenName: string;
  familyIds: string[];
  storyVisible: boolean;
  storyTitle: string | null;
}

interface AsksDesignatorProps {
  families: { id: string; name: string }[];
  /** Seed from the current `?families=` filter: a family id, or "all" (no single family selected). */
  seedFamilyId: string;
  asks: AsksDesignatorAsk[];
}

/** Resolve the initial designated family: the seed if it names a real family, else the first family. */
function resolveSeed(families: { id: string }[], seedFamilyId: string): string {
  if (families.some((f) => f.id === seedFamilyId)) return seedFamilyId;
  return families[0]?.id ?? "";
}

export function AsksDesignator({ families, seedFamilyId, asks }: AsksDesignatorProps) {
  const [selected, setSelected] = useState(() => resolveSeed(families, seedFamilyId));

  // <2 families → no chip bar; the sole family (or "all") view shows every ask. ≥2 families → the
  // designated family's asks PLUS any family-less asks (which belong to the asker regardless).
  const showChips = families.length >= 2;
  const visible = showChips
    ? asks.filter((a) => a.familyIds.length === 0 || a.familyIds.includes(selected))
    : asks;

  const heading = (
    <>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.asks.title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 0",
        }}
      >
        {hub.asks.intro}
      </p>
    </>
  );

  const chips = showChips ? (
    <div style={{ margin: "20px 0 0" }}>
      <FamilyChips
        families={families}
        value={selected}
        onSelect={setSelected}
      />
    </div>
  ) : null;

  if (visible.length === 0) {
    return (
      <div>
        {heading}
        {chips}
        <div
          style={{
            marginTop: 24,
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 30,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.asks.empty}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {chips}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "24px 0 0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {visible.map((a) => {
          const answeredVisible = a.status === "answered" && a.storyVisible && a.storyId;
          return (
            <li
              key={a.id}
              style={{
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-card)",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    lineHeight: "var(--leading-snug)",
                    color: "var(--text-body)",
                    margin: 0,
                  }}
                >
                  <span style={{ color: "var(--text-meta)" }}>
                    {hub.asks.forTarget(a.targetSpokenName)}
                  </span>{" "}
                  {a.questionText}
                </p>
              </div>

              {answeredVisible ? (
                <Link
                  href={`/hub/stories/${a.storyId}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    fontWeight: 600,
                    color: "var(--accent-strong)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  ▶ {a.storyTitle ?? hub.asks.listen}
                </Link>
              ) : a.status === "answered" ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "var(--tracking-mono)",
                    color: "var(--support)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {hub.asks.answeredPrivate}
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "var(--tracking-mono)",
                    color: "var(--support)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {hub.asks.inQueue}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
