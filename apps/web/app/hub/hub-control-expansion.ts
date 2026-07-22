/**
 * Pure hub control expansion resolver — ADR-0025 Amendment 2026-07-21 / #299.
 *
 * Decides which Stories/Album browse controls are expanded vs collapsed given available row width
 * and measured natural widths. This is the behavior seam for expansion precedence and Sub-tabs
 * stages; DOM measurement and panel chrome live elsewhere (#300/#301).
 *
 * Precedence (highest claim first): Sub tabs → Family → Search → Filters → Views. Collapse in reverse.
 * Sub tabs stages: labeled → icon-pills → menu-icon. Prefer a richer Sub-tabs stage over keeping
 * lower-precedence secondaries expanded (so Views collapses before Sub tabs leaves labeled).
 * Menu-icon is legal only after every present lower-precedence unit is collapsed (or absent).
 * Primary actions are outside this math — callers pass their reserved trailing width so browse
 * units cannot spend it.
 *
 * Unit identity note: Stories collapsed search is the Search unit (not Filters). The resolver
 * models Search and Filters as separate occupancy; labeling is a copy concern for #301.
 */

/** Browse-control vocabulary units (shared; a surface omits units it does not have). */
export type HubControlUnit = "subTabs" | "family" | "search" | "filters" | "views";

/** Sub tabs progressive stages (richest → most collapsed). */
export type SubTabsStage = "labeled" | "icon-pills" | "menu-icon";

/** Binary expand/collapse form for Family / Search / Filters / Views. */
export type HubControlBinaryForm = "expanded" | "collapsed-icon";

/** Measured natural widths for Sub tabs' three stages. */
export interface SubTabsWidths {
  labeled: number;
  iconPills: number;
  menuIcon: number;
}

/** Measured natural widths for a binary unit. */
export interface BinaryUnitWidths {
  expanded: number;
  collapsedIcon: number;
}

/**
 * Widths for units that may be present. Callers only need to supply entries for `present` units;
 * omitted entries for absent units are ignored.
 */
export interface HubControlUnitWidths {
  subTabs?: SubTabsWidths;
  family?: BinaryUnitWidths;
  search?: BinaryUnitWidths;
  filters?: BinaryUnitWidths;
  views?: BinaryUnitWidths;
}

/** Which vocabulary units occupy the row on this surface / viewer. */
export interface HubControlPresentUnits {
  subTabs?: boolean;
  family?: boolean;
  search?: boolean;
  filters?: boolean;
  views?: boolean;
}

export interface HubControlExpansionInput {
  /** Total horizontal budget for the control row (including the reserved action). */
  availableWidth: number;
  /** Trailing primary-action width (Tell / Add Photos). Not competed for by browse-unit expansion. */
  reservedActionWidth: number;
  present: HubControlPresentUnits;
  widths: HubControlUnitWidths;
}

/**
 * Resolved expansion state. Absent units are `null` so callers can distinguish "not on this surface"
 * from "present but collapsed".
 */
export interface HubControlExpansion {
  subTabs: SubTabsStage | null;
  family: HubControlBinaryForm | null;
  search: HubControlBinaryForm | null;
  filters: HubControlBinaryForm | null;
  views: HubControlBinaryForm | null;
}

/** Secondary units in expansion-precedence order (highest claim first). Collapse walks this reversed. */
const SECONDARIES = ["family", "search", "filters", "views"] as const;
type SecondaryUnit = (typeof SECONDARIES)[number];

/** Rich Sub-tabs stages tried before menu-icon (menu-icon is last-resort only). */
const SUB_TABS_RICH_STAGES: readonly SubTabsStage[] = ["labeled", "icon-pills"];

function isPresent(present: HubControlPresentUnits, unit: HubControlUnit): boolean {
  return present[unit] === true;
}

function secondaryWidth(
  unit: SecondaryUnit,
  form: HubControlBinaryForm,
  widths: HubControlUnitWidths,
): number {
  const w = widths[unit];
  if (!w) return 0;
  return form === "expanded" ? w.expanded : w.collapsedIcon;
}

function subTabsWidth(stage: SubTabsStage, widths: HubControlUnitWidths): number {
  const w = widths.subTabs;
  if (!w) return 0;
  switch (stage) {
    case "labeled":
      return w.labeled;
    case "icon-pills":
      return w.iconPills;
    case "menu-icon":
      return w.menuIcon;
  }
}

function budgetFor(input: HubControlExpansionInput): number {
  const available = Number.isFinite(input.availableWidth) ? Math.max(0, input.availableWidth) : 0;
  const reserved = Number.isFinite(input.reservedActionWidth)
    ? Math.max(0, input.reservedActionWidth)
    : 0;
  return Math.max(0, available - reserved);
}

function totalWidth(
  subTabs: SubTabsStage | null,
  secondaryForms: Record<SecondaryUnit, HubControlBinaryForm | null>,
  widths: HubControlUnitWidths,
): number {
  let total = 0;
  if (subTabs !== null) total += subTabsWidth(subTabs, widths);
  for (const unit of SECONDARIES) {
    const form = secondaryForms[unit];
    if (form !== null) total += secondaryWidth(unit, form, widths);
  }
  return total;
}

function buildSecondaryForms(
  present: HubControlPresentUnits,
  expandedCount: number,
): Record<SecondaryUnit, HubControlBinaryForm | null> {
  const presentSecondaries = SECONDARIES.filter((u) => isPresent(present, u));
  const forms: Record<SecondaryUnit, HubControlBinaryForm | null> = {
    family: null,
    search: null,
    filters: null,
    views: null,
  };
  for (let i = 0; i < presentSecondaries.length; i++) {
    const unit = presentSecondaries[i]!;
    forms[unit] = i < expandedCount ? "expanded" : "collapsed-icon";
  }
  return forms;
}

function toResult(
  present: HubControlPresentUnits,
  subTabs: SubTabsStage | null,
  secondaryForms: Record<SecondaryUnit, HubControlBinaryForm | null>,
): HubControlExpansion {
  return {
    subTabs: isPresent(present, "subTabs") ? subTabs : null,
    family: secondaryForms.family,
    search: secondaryForms.search,
    filters: secondaryForms.filters,
    views: secondaryForms.views,
  };
}

/**
 * Resolve the richest legal expansion state that fits in the browse budget
 * (`availableWidth - reservedActionWidth`).
 *
 * Outer preference is Sub-tabs stage richness (labeled before icon-pills before menu-icon). Within a
 * stage, keep as many high-precedence secondaries expanded as will fit. That yields collapse order
 * Views → Filters → Search → Family before Sub tabs leaves labeled, matching ADR precedence.
 */
export function resolveHubControlExpansion(input: HubControlExpansionInput): HubControlExpansion {
  const { present, widths } = input;
  const budget = budgetFor(input);
  const presentSecondaries = SECONDARIES.filter((u) => isPresent(present, u));
  const hasSubTabs = isPresent(present, "subTabs");
  const stagePass: readonly (SubTabsStage | null)[] = hasSubTabs ? SUB_TABS_RICH_STAGES : [null];

  for (const stage of stagePass) {
    for (let expandedCount = presentSecondaries.length; expandedCount >= 0; expandedCount--) {
      const secondaryForms = buildSecondaryForms(present, expandedCount);
      if (totalWidth(stage, secondaryForms, widths) <= budget) {
        return toResult(present, stage, secondaryForms);
      }
    }
  }

  // Labeled / icon-pills cannot fit even with every secondary collapsed — menu-icon is now legal.
  const fullyCollapsed = buildSecondaryForms(present, 0);
  if (hasSubTabs && totalWidth("menu-icon", fullyCollapsed, widths) <= budget) {
    return toResult(present, "menu-icon", fullyCollapsed);
  }

  // Even the most-collapsed legal layout exceeds the budget — still return it (caller / layout
  // may overflow; precedence is already fully collapsed).
  return toResult(present, hasSubTabs ? "menu-icon" : null, fullyCollapsed);
}
