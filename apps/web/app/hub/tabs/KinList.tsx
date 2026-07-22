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
 * the governable-edges section. `onSelectPerson` is optional so KinList stays mountable read-only
 * (e.g. isolated unit tests) when omitted.
 *
 * #337 — steward-only **This is the same person as…** on a row ⋮ when complementary candidates exist
 * (H+). Non-stewards never see it; placeholders never start the flow. The ⋮ sits OUTSIDE the row's
 * select button so we never nest interactive controls.
 *
 * Styling: CSS Modules + data-skin Phase-2 (issue #266). Base classes are skin-neutral; Scrapbook
 * signatures live in KinList.module.css under :global(:root[data-skin="scrapbook"]) — no skin id in
 * component logic.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KinRelation } from "@chronicle/core";
import { hub } from "@/app/_copy";
import {
  asReconcilePerson,
  type FamilyListPerson,
} from "@/lib/family-list-people";
import { canOfferReconcile } from "@/lib/reconcile-eligibility";
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
  /** #337 — steward-only reconcile affordance. */
  viewerIsSteward?: boolean;
  /** Opens the shared reconcile flow for this person id. */
  onReconcile?: (personId: string) => void;
  /** After a successful reconcile, briefly highlight the winner row. */
  highlightedPersonId?: string | null;
}

export function KinList({
  people,
  onSelectPerson,
  viewerIsSteward = false,
  onReconcile,
  highlightedPersonId = null,
}: KinListProps) {
  const [query, setQuery] = useState("");
  const pool = useMemo(() => people.map(asReconcilePerson), [people]);

  // #337 — after success the winner may not match the current search (e.g. reconciled from a
  // mention-name query onto a differently named member). Clear search when a highlight arrives so
  // the focused row is actually rendered for scroll/outline.
  useEffect(() => {
    if (highlightedPersonId) setQuery("");
  }, [highlightedPersonId]);

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
            const start = asReconcilePerson(entry);
            const showReconcile =
              onReconcile != null && canOfferReconcile(viewerIsSteward, start, pool);
            const highlighted = highlightedPersonId === entry.personId;

            const primary = (
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
            );

            const rowEnd = (
              <span className={styles.rowEnd}>
                {entry.relation ? (
                  <span className={styles.relation}>{relationLabel(entry.relation)}</span>
                ) : null}
                {showReconcile ? (
                  <ListRowMenu
                    personId={entry.personId}
                    onReconcile={() => onReconcile(entry.personId)}
                  />
                ) : null}
              </span>
            );

            // Row chrome lives on `<li>` so the optional ⋮ can sit beside the select control without
            // nesting buttons. With `onSelectPerson`, the name/badge area is the activatable button and
            // carries `family-list-row-*` (matches #330 tests / a11y). Without it, the inert `<li>`
            // carries the same test id (pre-#330 markup shape).
            return (
              <li
                key={entry.personId}
                className={styles.row}
                data-testid={onSelectPerson ? undefined : `family-list-row-${entry.personId}`}
                data-highlighted={highlighted ? "true" : undefined}
                ref={
                  highlighted
                    ? (el) => {
                        // jsdom has no scrollIntoView; skip in tests, run in the browser.
                        if (el && typeof el.scrollIntoView === "function") {
                          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        }
                      }
                    : undefined
                }
              >
                {onSelectPerson ? (
                  <button
                    type="button"
                    className={styles.rowSelect}
                    data-testid={`family-list-row-${entry.personId}`}
                    onClick={() => onSelectPerson(entry)}
                  >
                    {primary}
                  </button>
                ) : (
                  primary
                )}
                {rowEnd}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListRowMenu({ personId, onReconcile }: { personId: string; onReconcile: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.rowMenu}>
      <button
        type="button"
        data-testid={`family-list-kebab-${personId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={hub.reconcile.moreActionsAria}
        className={styles.kebabTrigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">{"⋮"}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          data-testid={`family-list-menu-${personId}`}
          className={styles.kebabMenu}
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`family-list-reconcile-${personId}`}
            className={styles.kebabItem}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onReconcile();
            }}
          >
            {hub.reconcile.action}
          </button>
        </div>
      ) : null}
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
