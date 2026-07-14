"use client";
/**
 * KinList — the Family tab's List view (2026-07-14). A read-only, searchable list of the viewer's
 * relatives in the current family, mirroring the old /hub/kin list (now removed). Adding relatives moved
 * to the Tree view's per-card affordances, so this surface is purely for browsing/finding kin; the
 * search box filters by name or relation, client-side over the already-loaded list.
 */
import { useMemo, useState } from "react";
import type { KinListEntry, KinRelation } from "@chronicle/core";
import { hub } from "@/app/_copy";

function relationLabel(relation: KinRelation): string {
  return hub.kin.relationLabel[relation];
}

/** An identified relative shows their own name; an unidentified placeholder reads from its relation. */
function displayNameFor(entry: KinListEntry): string {
  if (entry.identified && entry.displayName) return entry.displayName;
  return hub.kin.unknownOf(relationLabel(entry.relation));
}

export function KinList({ kin }: { kin: KinListEntry[] }) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return kin;
    return kin.filter((entry) => {
      const haystack = `${displayNameFor(entry)} ${relationLabel(entry.relation)}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [kin, trimmed]);

  return (
    <div style={{ maxWidth: 720 }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={hub.kin.searchPlaceholder}
        aria-label={hub.kin.searchAria}
        style={{
          width: "100%",
          padding: "12px 16px",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-body)",
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          outline: "none",
          marginBottom: 20,
          boxSizing: "border-box",
        }}
      />

      {kin.length === 0 ? (
        <EmptyCard>{hub.kin.empty}</EmptyCard>
      ) : results.length === 0 ? (
        <EmptyCard>{hub.kin.searchNoResults(query.trim())}</EmptyCard>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {results.map((entry) => (
            <li
              key={entry.personId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "16px 20px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "var(--text-story)",
                  color:
                    entry.identified && entry.displayName ? "var(--text-body)" : "var(--text-muted)",
                }}
              >
                {displayNameFor(entry)}
                {entry.lifeStatus === "deceased" ? (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui-sm)",
                      color: "var(--text-meta)",
                      marginLeft: 10,
                    }}
                  >
                    · {hub.kin.deceased}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {relationLabel(entry.relation)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
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
        {children}
      </p>
    </div>
  );
}
