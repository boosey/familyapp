"use client";

/**
 * HubProgressiveControlRow (#301/#297) — one progressive-collapse control row for hub browse surfaces.
 *
 * Observes available width, measures natural widths of each unit form (Sub tabs stages + binary
 * expanded/collapsed), reserves trailing primary-action width, and asks
 * {@link resolveHubControlExpansion} which forms to show. Collapsed Family/Search/Filters/Views are
 * caller-supplied IconSheet nodes (#300 shells). Sub tabs menu-icon is a menu, not a sheet.
 *
 * Stories/Album/Family/Questions must not depend on HubToolbar's two-row composition for their
 * browse chrome (Album may still use HubToolbar until #302 lands on master).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  resolveHubControlExpansion,
  type HubControlExpansion,
  type HubControlPresentUnits,
  type HubControlUnitWidths,
} from "./hub-control-expansion";
import { HUB_PROGRESSIVE_CONTROL_GAP_PX } from "./hub-progressive-control-constants";
import { resolvePrimaryActionForm } from "./primary-action-form";
import s from "./HubProgressiveControlRow.module.css";

export type BinaryUnitSlot = {
  expanded: ReactNode;
  collapsed: ReactNode;
};

export type SubTabsUnitSlot = {
  labeled: ReactNode;
  iconPills: ReactNode;
  menuIcon: ReactNode;
};

export type PrimaryActionSlot = {
  labeled: ReactNode;
  iconified: ReactNode;
};

export interface HubProgressiveControlRowProps {
  subTabs?: SubTabsUnitSlot;
  family?: BinaryUnitSlot;
  search?: BinaryUnitSlot;
  filters?: BinaryUnitSlot;
  views?: BinaryUnitSlot;
  /** Trailing primary action (Tell / Add Photos) — outside collapse precedence; may iconify. */
  action?: PrimaryActionSlot;
  /** Optional full-width content below the row (e.g. Stories draft reminders). */
  belowRow?: ReactNode;
  /**
   * Test seam: force available row width (skips ResizeObserver). When set with {@link forceWidths},
   * expansion is fully deterministic without layout.
   */
  forceAvailableWidth?: number;
  /** Test seam: skip DOM measurement and use these widths. */
  forceWidths?: HubControlUnitWidths & {
    actionLabeled?: number;
    actionIconified?: number;
  };
}

type MeasureKey =
  | "subTabsLabeled"
  | "subTabsIconPills"
  | "subTabsMenuIcon"
  | "familyExpanded"
  | "familyCollapsed"
  | "searchExpanded"
  | "searchCollapsed"
  | "filtersExpanded"
  | "filtersCollapsed"
  | "viewsExpanded"
  | "viewsCollapsed"
  | "actionLabeled"
  | "actionIconified";

function presentFromProps(props: HubProgressiveControlRowProps): HubControlPresentUnits {
  return {
    subTabs: props.subTabs != null,
    family: props.family != null,
    search: props.search != null,
    filters: props.filters != null,
    views: props.views != null,
  };
}

function readWidth(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  return Math.ceil(el.getBoundingClientRect().width);
}

function gapsWidth(browseCount: number, hasAction: boolean): number {
  const unitCount = browseCount + (hasAction ? 1 : 0);
  return Math.max(0, unitCount - 1) * HUB_PROGRESSIVE_CONTROL_GAP_PX;
}

function minBrowseWidth(present: HubControlPresentUnits, widths: HubControlUnitWidths): number {
  let total = 0;
  if (present.subTabs) total += widths.subTabs?.menuIcon ?? 0;
  if (present.family) total += widths.family?.collapsedIcon ?? 0;
  if (present.search) total += widths.search?.collapsedIcon ?? 0;
  if (present.filters) total += widths.filters?.collapsedIcon ?? 0;
  if (present.views) total += widths.views?.collapsedIcon ?? 0;
  return total;
}

function defaultExpansion(present: HubControlPresentUnits): HubControlExpansion {
  return {
    subTabs: present.subTabs ? "labeled" : null,
    family: present.family ? "expanded" : null,
    search: present.search ? "expanded" : null,
    filters: present.filters ? "expanded" : null,
    views: present.views ? "expanded" : null,
  };
}

function browseUnitCount(present: HubControlPresentUnits): number {
  return (["subTabs", "family", "search", "filters", "views"] as const).filter((u) => present[u])
    .length;
}

/** Structural equality — ResizeObserver fires every frame during drag-resize; skip setState when forms are unchanged. */
function expansionEqual(a: HubControlExpansion, b: HubControlExpansion): boolean {
  return (
    a.subTabs === b.subTabs &&
    a.family === b.family &&
    a.search === b.search &&
    a.filters === b.filters &&
    a.views === b.views
  );
}

export function HubProgressiveControlRow(props: HubProgressiveControlRowProps) {
  const {
    subTabs,
    family,
    search,
    filters,
    views,
    action,
    belowRow,
    forceAvailableWidth,
    forceWidths,
  } = props;

  const present = presentFromProps(props);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRefs = useRef<Partial<Record<MeasureKey, HTMLElement | null>>>({});
  const setMeasureRef = useCallback(
    (key: MeasureKey) => (el: HTMLElement | null) => {
      measureRefs.current[key] = el;
    },
    [],
  );

  const [expansion, setExpansion] = useState<HubControlExpansion>(() => defaultExpansion(present));
  const [actionForm, setActionForm] = useState<"labeled" | "iconified">("labeled");

  // Presence fingerprint — recompute when occupancy changes; slot element identity is read from props
  // at call time via ref so ReactNode identity churn does not retrigger the layout effect.
  const presentKey = [
    present.subTabs,
    present.family,
    present.search,
    present.filters,
    present.views,
    action != null,
  ].join("|");
  const propsRef = useRef(props);
  propsRef.current = props;

  const gapStyle = {
    gap: HUB_PROGRESSIVE_CONTROL_GAP_PX,
  } satisfies CSSProperties;

  const recompute = useCallback(() => {
    const latest = propsRef.current;
    const presentNow = presentFromProps(latest);
    const browseCount = browseUnitCount(presentNow);
    const hasAction = latest.action != null;
    const gaps = gapsWidth(browseCount, hasAction);

    const rowWidth =
      latest.forceAvailableWidth != null
        ? latest.forceAvailableWidth
        : rowRef.current
          ? Math.floor(rowRef.current.getBoundingClientRect().width)
          : 0;

    const forced = latest.forceWidths;
    const widths: HubControlUnitWidths = forced
      ? {
          subTabs: forced.subTabs,
          family: forced.family,
          search: forced.search,
          filters: forced.filters,
          views: forced.views,
        }
      : {
          subTabs: presentNow.subTabs
            ? {
                labeled: readWidth(measureRefs.current.subTabsLabeled),
                iconPills: readWidth(measureRefs.current.subTabsIconPills),
                menuIcon: readWidth(measureRefs.current.subTabsMenuIcon),
              }
            : undefined,
          family: presentNow.family
            ? {
                expanded: readWidth(measureRefs.current.familyExpanded),
                collapsedIcon: readWidth(measureRefs.current.familyCollapsed),
              }
            : undefined,
          search: presentNow.search
            ? {
                expanded: readWidth(measureRefs.current.searchExpanded),
                collapsedIcon: readWidth(measureRefs.current.searchCollapsed),
              }
            : undefined,
          filters: presentNow.filters
            ? {
                expanded: readWidth(measureRefs.current.filtersExpanded),
                collapsedIcon: readWidth(measureRefs.current.filtersCollapsed),
              }
            : undefined,
          views: presentNow.views
            ? {
                expanded: readWidth(measureRefs.current.viewsExpanded),
                collapsedIcon: readWidth(measureRefs.current.viewsCollapsed),
              }
            : undefined,
        };

    const actionLabeledW =
      forced?.actionLabeled ?? readWidth(measureRefs.current.actionLabeled);
    const actionIconifiedW =
      forced?.actionIconified ?? readWidth(measureRefs.current.actionIconified);

    // No useful measurement yet (SSR / first paint before layout) — keep richest defaults.
    if (rowWidth <= 0) {
      const fallback = defaultExpansion(presentNow);
      setExpansion((prev) => (expansionEqual(prev, fallback) ? prev : fallback));
      setActionForm((prev) => (prev === "labeled" ? prev : "labeled"));
      return;
    }

    const nextAction = hasAction
      ? resolvePrimaryActionForm({
          availableWidth: rowWidth,
          minBrowseWidth: minBrowseWidth(presentNow, widths),
          gapsWidth: gaps,
          labeledActionWidth: actionLabeledW,
          iconifiedActionWidth: actionIconifiedW,
        })
      : "labeled";
    const reservedAction = hasAction
      ? nextAction === "labeled"
        ? actionLabeledW
        : actionIconifiedW
      : 0;

    const next = resolveHubControlExpansion({
      // Resolver budget includes the reserved action; gaps are removed so unit sums stay gap-free.
      availableWidth: Math.max(0, rowWidth - gaps),
      reservedActionWidth: reservedAction,
      present: presentNow,
      widths,
    });

    // Bail when forms are unchanged — otherwise every resize frame re-commits the row + measure clones.
    setActionForm((prev) => (prev === nextAction ? prev : nextAction));
    setExpansion((prev) => (expansionEqual(prev, next) ? prev : next));
  }, []);

  useLayoutEffect(() => {
    recompute();
  }, [recompute, presentKey, forceAvailableWidth, forceWidths]);

  useEffect(() => {
    if (forceAvailableWidth != null) return;
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      recompute();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [forceAvailableWidth, recompute]);

  const anyBrowse =
    present.subTabs || present.family || present.search || present.filters || present.views;
  if (!anyBrowse && !action && !belowRow) return null;

  function renderSubTabs() {
    if (!subTabs || expansion.subTabs == null) return null;
    switch (expansion.subTabs) {
      case "labeled":
        return subTabs.labeled;
      case "icon-pills":
        return subTabs.iconPills;
      case "menu-icon":
        return subTabs.menuIcon;
    }
  }

  function renderBinary(
    slot: BinaryUnitSlot | undefined,
    form: "expanded" | "collapsed-icon" | null,
  ) {
    if (!slot || form == null) return null;
    return form === "expanded" ? slot.expanded : slot.collapsed;
  }

  return (
    <>
      <div
        ref={rowRef}
        className={s.row}
        style={gapStyle}
        data-hub-progressive-control-row=""
        data-sub-tabs={expansion.subTabs ?? "none"}
        data-search={expansion.search ?? "none"}
        data-family={expansion.family ?? "none"}
        data-filters={expansion.filters ?? "none"}
        data-views={expansion.views ?? "none"}
        data-action={action ? actionForm : "none"}
      >
        {anyBrowse ? (
          <div className={s.units} style={gapStyle}>
            {renderSubTabs()}
            {renderBinary(family, expansion.family)}
            {renderBinary(search, expansion.search)}
            {renderBinary(filters, expansion.filters)}
            {renderBinary(views, expansion.views)}
          </div>
        ) : null}
        {action ? (
          <div className={s.action}>
            {actionForm === "labeled" ? action.labeled : action.iconified}
          </div>
        ) : null}
      </div>

      {/* Natural-width probes — always mounted when the unit is present so ResizeObserver recompute
          can read every form the resolver may pick. */}
      <div className={s.measure} aria-hidden="true">
        {subTabs ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("subTabsLabeled")}>
              {subTabs.labeled}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("subTabsIconPills")}>
              {subTabs.iconPills}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("subTabsMenuIcon")}>
              {subTabs.menuIcon}
            </div>
          </>
        ) : null}
        {family ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("familyExpanded")}>
              {family.expanded}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("familyCollapsed")}>
              {family.collapsed}
            </div>
          </>
        ) : null}
        {search ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("searchExpanded")}>
              {search.expanded}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("searchCollapsed")}>
              {search.collapsed}
            </div>
          </>
        ) : null}
        {filters ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("filtersExpanded")}>
              {filters.expanded}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("filtersCollapsed")}>
              {filters.collapsed}
            </div>
          </>
        ) : null}
        {views ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("viewsExpanded")}>
              {views.expanded}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("viewsCollapsed")}>
              {views.collapsed}
            </div>
          </>
        ) : null}
        {action ? (
          <>
            <div className={s.measureItem} ref={setMeasureRef("actionLabeled")}>
              {action.labeled}
            </div>
            <div className={s.measureItem} ref={setMeasureRef("actionIconified")}>
              {action.iconified}
            </div>
          </>
        ) : null}
      </div>

      {belowRow ? <div className={s.belowRow}>{belowRow}</div> : null}
    </>
  );
}
