import type { ReactNode } from "react";
import styles from "./HubToolbar.module.css";

/**
 * HubToolbar (#189) — the ONE two-row control block every hub sub-tab (Stories, Album, Family,
 * Questions) composes, so their toolbars can't drift apart. Four named slots:
 *
 *   R1:  [row1Left: sub-tab pills + search/filters]   ·······  [row1Right: primary action]
 *   R2:  [row2Left: family selector]                  ·······  [row2Right: view/layout controls]
 *
 * Layout rules (load-bearing):
 *  - The right-hand slot of each row is right-justified; both rows wrap safely on narrow viewports.
 *  - A row whose BOTH slots are empty/nullish is NOT rendered — no element, no reserved vertical space.
 *    A tab with no R2 content therefore shows only R1, flush against the content below (this is how
 *    Family's "List view + <2 families → no selector row" behaviour is expressed through the toolbar).
 *
 * Presentational only: it renders whatever nodes it is handed. Each surface owns its slot content (and
 * the "is there content?" decision — pass `null`/`undefined`/`false` for an empty slot).
 */
export interface HubToolbarProps {
  row1Left?: ReactNode;
  row1Right?: ReactNode;
  row2Left?: ReactNode;
  row2Right?: ReactNode;
}

/** A slot counts as empty when it is nullish or the literal `false` (a common `cond && <x/>` result). */
function hasContent(slot: ReactNode): boolean {
  return slot !== null && slot !== undefined && slot !== false;
}

function ToolbarRow({ left, right }: { left: ReactNode; right: ReactNode }) {
  // Never render the row when neither slot has content — the empty-row rule (no reserved space).
  if (!hasContent(left) && !hasContent(right)) return null;
  return (
    <div className={styles.row}>
      {hasContent(left) ? <div className={styles.left}>{left}</div> : null}
      {hasContent(right) ? <div className={styles.right}>{right}</div> : null}
    </div>
  );
}

export function HubToolbar({ row1Left, row1Right, row2Left, row2Right }: HubToolbarProps) {
  const row1 = <ToolbarRow left={row1Left} right={row1Right} />;
  const row2 = <ToolbarRow left={row2Left} right={row2Right} />;
  // Render nothing at all (not an empty wrapper) when both rows are absent, so a fully-empty toolbar
  // reserves no space above the tab content.
  const anyRow =
    hasContent(row1Left) || hasContent(row1Right) || hasContent(row2Left) || hasContent(row2Right);
  if (!anyRow) return null;
  return (
    <div className={styles.toolbar}>
      {row1}
      {row2}
    </div>
  );
}
