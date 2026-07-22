"use client";
/**
 * KinList — the Family tab's List view. A searchable people index of the full family projection
 * (#283 / ADR-0023 amendment): members, edged tree-only relatives, and unplaced members. Each row
 * shows a membership-first badge (Member vs tree-only) and may show a derived relation chip. List
 * itself never mutates kinship edges or places members — placement and edge governance (Remove/Hide)
 * live on Tree only.
 *
 * #330 — a row is activatable (click/Enter/Space via `onSelectPerson`) so the caller (FamilyTab) can
 * open the SAME `PersonDetails` sheet Tree uses (details/Edit/Stories·Photos·Mentions), just without
 * the governable-edges section or the Invite affordance. `onSelectPerson` is optional so KinList stays
 * mountable read-only (e.g. isolated unit tests) when omitted.
 *
 * Styling: CSS Modules + data-skin Phase-2 (issue #266). Base classes are skin-neutral; Scrapbook
 * signatures live in KinList.module.css under :global(:root[data-skin="scrapbook"]) — no skin id in
 * component logic.
 */
import { useMemo, useState } from "react";
import type { KinRelation } from "@chronicle/core";
import { hub } from "@/app/_copy";
import type { FamilyListPerson } from "@/lib/family-list-people";
import styles from "./KinList.module.css";

function relationLabel(relation: KinRelation): string {
  return hub.kin.relationLabel[relation];
}

function membershipLabel(membership: FamilyListPerson["membership"]): string {
  return membership === "member"
    ? hub.kin.membershipBadge.member
    : hub.kin.membershipBadge.treeOnly;
}

/** An identified person shows their name; an unidentified placeholder reads from its relation. */
function displayNameFor(entry: FamilyListPerson): string {
  if (entry.identified && entry.displayName) return entry.displayName;
  if (entry.relation) return hub.kin.unknownOf(relationLabel(entry.relation));
  return hub.kin.unknownRelative;
}

export interface KinListProps {
  people: FamilyListPerson[];
  /** #330 — activates a row (click/Enter/Space); omitted ⇒ rows render as plain, inert list items. */
  onSelectPerson?: (person: FamilyListPerson) => void;
}

export function KinList({ people, onSelectPerson }: KinListProps) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return people;
    return people.filter((entry) => {
      const relation = entry.relation ? relationLabel(entry.relation) : "";
      const haystack =
        `${displayNameFor(entry)} ${relation} ${membershipLabel(entry.membership)}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [people, trimmed]);

  return (
    <div className={styles.root} data-testid="family-list">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={hub.kin.searchPlaceholder}
        aria-label={hub.kin.searchAria}
        className={styles.search}
      />

      {people.length === 0 ? (
        <EmptyCard>{hub.kin.empty}</EmptyCard>
      ) : results.length === 0 ? (
        <EmptyCard>{hub.kin.searchNoResults(query.trim())}</EmptyCard>
      ) : (
        <ul className={styles.list}>
          {results.map((entry) => {
            const known = Boolean(entry.identified && entry.displayName);
            const rowContent = (
              <>
                <span className={styles.primary}>
                  <span className={known ? styles.name : `${styles.name} ${styles.nameUnknown}`}>
                    {displayNameFor(entry)}
                    {entry.lifeStatus === "deceased" ? (
                      <span className={styles.deceased}>· {hub.kin.deceased}</span>
                    ) : null}
                  </span>
                  <span
                    className={styles.badge}
                    data-testid={`family-list-badge-${entry.personId}`}
                    data-membership={entry.membership}
                  >
                    {membershipLabel(entry.membership)}
                  </span>
                </span>
                {entry.relation ? (
                  <span className={styles.relation}>{relationLabel(entry.relation)}</span>
                ) : null}
              </>
            );
            // Without a handler the row stays a plain, inert `<li>` (matches the pre-#330 markup
            // exactly). With a handler the row becomes a real `<button>` for native click + keyboard
            // (Enter/Space) activation and focus semantics; the `<li>` around it carries no class.
            return onSelectPerson ? (
              <li key={entry.personId}>
                <button
                  type="button"
                  className={`${styles.row} ${styles.rowButton}`}
                  data-testid={`family-list-row-${entry.personId}`}
                  onClick={() => onSelectPerson(entry)}
                >
                  {rowContent}
                </button>
              </li>
            ) : (
              <li
                key={entry.personId}
                className={styles.row}
                data-testid={`family-list-row-${entry.personId}`}
              >
                {rowContent}
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
