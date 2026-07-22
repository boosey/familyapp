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
 *
 * Styling lives in AsksDesignator.module.css (token-driven base + skin-scoped Scrapbook signatures:
 * tilt/tape/highlighter/sticker status pill/hover-lift, suppressed under reduce-motion / solemn).
 * Tilt math stays in TS (card-tilt). See apps/web/app/_skins/CSS-MODULES.md.
 */
import { useState } from "react";
import Link from "next/link";
import { FamilyChips } from "@/app/hub/FamilyChips";
import { hub } from "@/app/_copy";
import { cardTilt } from "./card-tilt";
import styles from "./AsksDesignator.module.css";

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
  families: { id: string; name: string; shortName?: string | null }[];
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
      <h2 className={styles.title}>{hub.asks.title}</h2>
      <p className={styles.intro}>{hub.asks.intro}</p>
    </>
  );

  const chips = showChips ? (
    <div className={styles.chips}>
      <FamilyChips families={families} value={selected} onSelect={setSelected} />
    </div>
  ) : null;

  if (visible.length === 0) {
    return (
      <div>
        {heading}
        {chips}
        <div className={styles.empty} style={cardTilt(0)}>
          <p className={styles.emptyText}>{hub.asks.empty}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {chips}
      <ul className={styles.list}>
        {visible.map((a, i) => {
          const answeredVisible = a.status === "answered" && a.storyVisible && a.storyId;
          return (
            <li key={a.id} className={styles.card} style={cardTilt(i)}>
              <div className={styles.cardBody}>
                <p className={styles.question}>
                  <span className={styles.forTarget}>{hub.asks.forTarget(a.targetSpokenName)}</span>{" "}
                  {a.questionText}
                </p>
              </div>

              {answeredVisible ? (
                <Link href={`/hub/stories/${a.storyId}`} className={styles.storyLink}>
                  ▶ {a.storyTitle ?? hub.asks.listen}
                </Link>
              ) : a.status === "answered" ? (
                <span className={styles.status}>{hub.asks.answeredPrivate}</span>
              ) : (
                <span className={styles.status}>{hub.asks.inQueue}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
