/**
 * Issue #299 — pure hub control expansion resolver (ADR-0025 Amendment 2026-07-21).
 * Behavior seam for progressive-collapse precedence and Sub-tabs stages; no DOM measurement.
 */
import { describe, expect, it } from "vitest";
import {
  resolveHubControlExpansion,
  type HubControlExpansionInput,
  type HubControlUnitWidths,
} from "./hub-control-expansion";

/** Convenient widths used across cases. Numbers are arbitrary but ordered so squeeze decisions are clear. */
const SUB_TABS = { labeled: 180, iconPills: 80, menuIcon: 40 } as const;
const FAMILY = { expanded: 160, collapsedIcon: 40 } as const;
const SEARCH = { expanded: 200, collapsedIcon: 40 } as const;
const FILTERS = { expanded: 140, collapsedIcon: 40 } as const;
const VIEWS = { expanded: 100, collapsedIcon: 40 } as const;

const ALL_WIDTHS: HubControlUnitWidths = {
  subTabs: SUB_TABS,
  family: FAMILY,
  search: SEARCH,
  filters: FILTERS,
  views: VIEWS,
};

function input(
  overrides: Partial<HubControlExpansionInput> &
    Pick<HubControlExpansionInput, "availableWidth">,
): HubControlExpansionInput {
  return {
    reservedActionWidth: 0,
    present: {
      subTabs: true,
      family: true,
      search: true,
      filters: true,
      views: true,
    },
    widths: ALL_WIDTHS,
    ...overrides,
  };
}

describe("resolveHubControlExpansion", () => {
  it("expands every present unit (Sub tabs labeled) when the full row fits", () => {
    // labeled + all expanded = 180+160+200+140+100 = 780
    const result = resolveHubControlExpansion(input({ availableWidth: 780 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "expanded",
      filters: "expanded",
      views: "expanded",
    });
  });

  it("reserves trailing action width so browse units cannot spend it", () => {
    // Same 780 content needs — but 48px reserved for Tell/Add Photos → must squeeze.
    const result = resolveHubControlExpansion(
      input({ availableWidth: 780, reservedActionWidth: 48 }),
    );
    expect(result.views).toBe("collapsed-icon");
    expect(result.subTabs).toBe("labeled");
    expect(result.family).toBe("expanded");
    expect(result.search).toBe("expanded");
    expect(result.filters).toBe("expanded");
  });

  it("collapses Views first (lowest precedence) before touching higher units", () => {
    // Full labeled row 780; drop below that but keep room for labeled + family + search + filters
    // + views collapsed: 180+160+200+140+40 = 720
    const result = resolveHubControlExpansion(input({ availableWidth: 720 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "expanded",
      filters: "expanded",
      views: "collapsed-icon",
    });
  });

  it("collapses Filters before Search (Filters lower precedence than Search)", () => {
    // Need Filters collapsed: labeled + family + search + filters-icon + views-icon
    // = 180+160+200+40+40 = 620
    const result = resolveHubControlExpansion(input({ availableWidth: 620 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "expanded",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("collapses Search before Family", () => {
    // labeled + family + search-icon + filters-icon + views-icon = 180+160+40+40+40 = 460
    const result = resolveHubControlExpansion(input({ availableWidth: 460 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "collapsed-icon",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("collapses Family to keep Sub tabs labeled before demoting to icon-pills", () => {
    // labeled + family expanded + icons = 460; budget 400 → collapse Family, keep labeled.
    // icon-pills + family expanded would also fit (360) but labeled outranks that pairing.
    const result = resolveHubControlExpansion(input({ availableWidth: 400 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "collapsed-icon",
      search: "collapsed-icon",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("keeps Family expanded with icon-pills when labeled cannot fit even fully collapsed", () => {
    // labeled never fits (500 + 4*40 = 660 > 360). icon-pills + Family expanded + icons = 360.
    const widths: HubControlUnitWidths = {
      subTabs: { labeled: 500, iconPills: 80, menuIcon: 40 },
      family: FAMILY,
      search: SEARCH,
      filters: FILTERS,
      views: VIEWS,
    };
    const result = resolveHubControlExpansion(input({ availableWidth: 360, widths }));
    expect(result).toEqual({
      subTabs: "icon-pills",
      family: "expanded",
      search: "collapsed-icon",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("prefers collapsing Views to keep Sub tabs labeled over demoting to icon-pills", () => {
    // At 720: icon-pills + all expanded (680) would fit, but labeled + Views collapsed (720) also
    // fits and wins — Sub tabs labeled outranks keeping Views expanded.
    const result = resolveHubControlExpansion(input({ availableWidth: 720 }));
    expect(result).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "expanded",
      filters: "expanded",
      views: "collapsed-icon",
    });
  });

  it("uses Sub tabs icon-pills with secondaries re-expanded when labeled cannot fit at all", () => {
    // Labeled (700) cannot fit even with every secondary collapsed (700+40*4=860).
    // icon-pills (80) can take all secondaries expanded again (80+160+200+140+100=680).
    const widths: HubControlUnitWidths = {
      subTabs: { labeled: 700, iconPills: 80, menuIcon: 40 },
      family: FAMILY,
      search: SEARCH,
      filters: FILTERS,
      views: VIEWS,
    };
    const result = resolveHubControlExpansion(
      input({ availableWidth: 680, widths }),
    );
    expect(result).toEqual({
      subTabs: "icon-pills",
      family: "expanded",
      search: "expanded",
      filters: "expanded",
      views: "expanded",
    });
  });

  it("allows Sub tabs menu-icon only after every present lower-precedence unit is collapsed", () => {
    // Even icon-pills + all collapsed icons: 80+40+40+40+40 = 240 doesn't fit.
    // menu-icon + all collapsed: 40+40+40+40+40 = 200 fits.
    const result = resolveHubControlExpansion(input({ availableWidth: 200 }));
    expect(result).toEqual({
      subTabs: "menu-icon",
      family: "collapsed-icon",
      search: "collapsed-icon",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("never returns menu-icon while any lower-precedence unit is still expanded", () => {
    // Pathological: labeled/icon-pills cannot fit with Family expanded, and menu-icon is forbidden
    // until Family collapses. Available width fits menu+family-expanded mathematically but the rule
    // forbids that pairing — resolver must collapse Family and then pick richest legal Sub-tabs stage.
    const widths: HubControlUnitWidths = {
      subTabs: { labeled: 500, iconPills: 400, menuIcon: 40 },
      family: { expanded: 100, collapsedIcon: 40 },
    };
    // Budget 140: menu(40)+family-expanded(100)=140 would "fit" but is illegal.
    // Legal: icon-pills can't (400); labeled can't. After Family collapses: menu(40)+family-icon(40)=80 fits;
    // icon-pills(400)+40 still no → menu-icon.
    const result = resolveHubControlExpansion({
      availableWidth: 140,
      reservedActionWidth: 0,
      present: { subTabs: true, family: true },
      widths,
    });
    expect(result.family).toBe("collapsed-icon");
    expect(result.subTabs).toBe("menu-icon");
  });

  it("skips absent units (Stories: no Filters; Album: no Sub tabs; Family/Questions sets)", () => {
    // Stories-like occupancy: Sub tabs + Family + Search + Views (no Filters)
    const stories = resolveHubControlExpansion({
      availableWidth: 1000,
      reservedActionWidth: 48,
      present: { subTabs: true, family: true, search: true, views: true },
      widths: {
        subTabs: SUB_TABS,
        family: FAMILY,
        search: SEARCH,
        views: VIEWS,
      },
    });
    expect(stories).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: "expanded",
      filters: null,
      views: "expanded",
    });

    // Album-like occupancy: Family + Search + Filters + Views (no Sub tabs)
    // Full expanded = 160+200+140+100 = 600; squeeze to collapse Views first.
    const album = resolveHubControlExpansion({
      availableWidth: 560,
      reservedActionWidth: 0,
      present: { family: true, search: true, filters: true, views: true },
      widths: {
        family: FAMILY,
        search: SEARCH,
        filters: FILTERS,
        views: VIEWS,
      },
    });
    expect(album).toEqual({
      subTabs: null,
      family: "expanded",
      search: "expanded",
      filters: "expanded",
      views: "collapsed-icon",
    });

    // Family-like occupancy (#297): Sub tabs + Family + Views (no Search/Filters); Invite reserved.
    // Full labeled + family + views = 180+160+100 = 440; budget 440-48=392 → collapse Views first
    // (labeled + family + views-icon = 380).
    const familySurf = resolveHubControlExpansion({
      availableWidth: 440,
      reservedActionWidth: 48,
      present: { subTabs: true, family: true, views: true },
      widths: { subTabs: SUB_TABS, family: FAMILY, views: VIEWS },
    });
    expect(familySurf).toEqual({
      subTabs: "labeled",
      family: "expanded",
      search: null,
      filters: null,
      views: "collapsed-icon",
    });

    // Questions-like occupancy (#297): Sub tabs only (no Family/Search/Filters/Views, no action).
    const questions = resolveHubControlExpansion({
      availableWidth: 200,
      reservedActionWidth: 0,
      present: { subTabs: true },
      widths: { subTabs: SUB_TABS },
    });
    expect(questions).toEqual({
      subTabs: "labeled",
      family: null,
      search: null,
      filters: null,
      views: null,
    });
  });

  it("keeps Search expanded while collapsing Filters when both cannot stay expanded (Album)", () => {
    // Album: search expanded + filters expanded + views collapsed = 200+140+40 = 380
    // Squeeze so Filters must go: search expanded + both icons = 200+40+40 = 280
    const result = resolveHubControlExpansion({
      availableWidth: 280,
      reservedActionWidth: 0,
      present: { search: true, filters: true, views: true },
      widths: { search: SEARCH, filters: FILTERS, views: VIEWS },
    });
    expect(result.search).toBe("expanded");
    expect(result.filters).toBe("collapsed-icon");
    expect(result.views).toBe("collapsed-icon");
    expect(result.subTabs).toBeNull();
    expect(result.family).toBeNull();
  });

  it("returns null for units that are not present", () => {
    const result = resolveHubControlExpansion({
      availableWidth: 200,
      reservedActionWidth: 0,
      present: { search: true },
      widths: { search: SEARCH },
    });
    expect(result).toEqual({
      subTabs: null,
      family: null,
      search: "expanded",
      filters: null,
      views: null,
    });
  });

  it("returns the most-collapsed legal layout when even menu-icon + all icons exceed the budget", () => {
    const result = resolveHubControlExpansion(input({ availableWidth: 1 }));
    expect(result).toEqual({
      subTabs: "menu-icon",
      family: "collapsed-icon",
      search: "collapsed-icon",
      filters: "collapsed-icon",
      views: "collapsed-icon",
    });
  });

  it("treats a non-finite available width as zero budget (fully collapsed)", () => {
    const result = resolveHubControlExpansion(input({ availableWidth: Number.NaN }));
    expect(result.subTabs).toBe("menu-icon");
    expect(result.family).toBe("collapsed-icon");
    expect(result.search).toBe("collapsed-icon");
    expect(result.filters).toBe("collapsed-icon");
    expect(result.views).toBe("collapsed-icon");
  });
});
