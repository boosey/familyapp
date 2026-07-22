/**
 * Collapsed browse-panel shell selection — ADR-0025 Amendment 2026-07-21 / #300.
 *
 * Family / Search / Filters / Views collapsed icons open the same panel body in either a bottom
 * sheet (compact) or an anchored popover (wide). Viewport → shell is a pure boolean map so tests
 * assert shell selection without CSS media queries or layout measurement. Expansion precedence
 * stays in {@link resolveHubControlExpansion}; this seam only picks chrome.
 *
 * Sub tabs menus are out of scope (they open a menu, not this panel shell).
 */

/** Shell used when a collapsed browse unit (Family / Search / Filters / Views) opens. */
export type CollapsedBrowseShell = "sheet" | "popover";

/**
 * Map compact vs wide viewport to the collapsed-panel shell.
 * `isCompact === true` → bottom sheet; otherwise → anchored popover.
 */
export function resolveCollapsedBrowseShell(isCompact: boolean): CollapsedBrowseShell {
  return isCompact ? "sheet" : "popover";
}
