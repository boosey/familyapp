"use client";
/**
 * KinList — the Family tab's List view (2026-07-14). A read-only, searchable list of the viewer's
 * relatives in the current family, mirroring the old /hub/kin list (now removed). Adding relatives moved
 * to the Tree view's per-card affordances, so this surface is purely for browsing/finding kin; the
 * search box filters by name or relation, client-side over the already-loaded list.
 *
 * Styling: CSS Modules + data-skin Phase-2 (issue #266). Base classes are skin-neutral; Playful
 * signatures live in KinList.module.css under :global(:root[data-skin="playful"]) — no skin id in
 * component logic.
 */
import { useMemo, useState } from "react";
import type { KinListEntry, KinRelation } from "@chronicle/core";
import { hub } from "@/app/_copy";
import styles from "./KinList.module.css";

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
    <div className={styles.root}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={hub.kin.searchPlaceholder}
        aria-label={hub.kin.searchAria}
        className={styles.search}
      />

      {kin.length === 0 ? (
        <EmptyCard>{hub.kin.empty}</EmptyCard>
      ) : results.length === 0 ? (
        <EmptyCard>{hub.kin.searchNoResults(query.trim())}</EmptyCard>
      ) : (
        <ul className={styles.list}>
          {results.map((entry) => {
            const known = Boolean(entry.identified && entry.displayName);
            return (
              <li key={entry.personId} className={styles.row}>
                <span className={known ? styles.name : `${styles.name} ${styles.nameUnknown}`}>
                  {displayNameFor(entry)}
                  {entry.lifeStatus === "deceased" ? (
                    <span className={styles.deceased}>· {hub.kin.deceased}</span>
                  ) : null}
                </span>
                <span className={styles.relation}>{relationLabel(entry.relation)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyText}>{children}</p>
    </div>
  );
}
