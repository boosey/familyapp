// @vitest-environment jsdom
/**
 * Stories progressive hub control row (#301) — thin wiring tests.
 * Precedence/stages live in resolveHubControlExpansion; these assert Stories occupancy, Search-not-
 * Filter collapsed labeling, single-row chrome, and that forced resolver inputs are honored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoriesSurface } from "./StoriesSurface";
import { HubProgressiveControlRow } from "../HubProgressiveControlRow";
import { hub } from "@/app/_copy";
import { Search } from "lucide-react";
import { IconSheet } from "../IconSheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/app/_kindred/useIsCompact", () => ({
  useIsCompact: () => false,
}));

afterEach(() => {
  cleanup();
});

const fam = (id: string, name: string) => ({ id, name });

const base = {
  items: [],
  viewerFamilies: [],
  viewerPersonId: "v1",
  viewerName: "You",
  selectedIds: [],
  allSelected: true as const,
  selfDrafts: [],
  intakeIncomplete: false,
  body: "browse" as const,
  emptyCopy: "",
};

const twoFamily = {
  ...base,
  activeFamilies: [fam("f1", "Marino"), fam("f2", "Esposito")],
  chipSelected: "all" as const,
};

/** Widths that force Search (and Views/Family) collapsed while Sub tabs stay labeled. */
const COLLAPSE_SECONDARIES = {
  subTabs: { labeled: 120, iconPills: 80, menuIcon: 48 },
  family: { expanded: 200, collapsedIcon: 48 },
  search: { expanded: 220, collapsedIcon: 48 },
  views: { expanded: 160, collapsedIcon: 48 },
  actionLabeled: 120,
  actionIconified: 48,
};

describe("StoriesSurface progressive control row (#301)", () => {
  it("renders a single progressive control row (not HubToolbar two-row chrome)", () => {
    render(<StoriesSurface {...twoFamily} />);
    expect(document.querySelectorAll("[data-hub-progressive-control-row]")).toHaveLength(1);
    // Stories no longer mounts HubToolbar — progressive row is the only control chrome.
    expect(document.querySelector("[data-hub-toolbar]")).toBeNull();
  });

  it("does not expose Filters chrome; collapsed Search uses Search label (not Filter)", () => {
    render(
      <HubProgressiveControlRow
        forceAvailableWidth={320}
        forceWidths={COLLAPSE_SECONDARIES}
        subTabs={{
          labeled: <span>FeedTimeline</span>,
          iconPills: <span>icons</span>,
          menuIcon: <span>menu</span>,
        }}
        family={{
          expanded: <span>families</span>,
          collapsed: (
            <IconSheet icon={Search} label={hub.mobileControls.familyLabel} sheetTitle={hub.mobileControls.familyLabel}>
              <span>families</span>
            </IconSheet>
          ),
        }}
        search={{
          expanded: <input type="search" aria-label={hub.browse.searchPlaceholder} />,
          collapsed: (
            <IconSheet
              icon={Search}
              label={hub.mobileControls.searchLabel}
              sheetTitle={hub.mobileControls.searchLabel}
            >
              <input type="search" aria-label={hub.browse.searchPlaceholder} />
            </IconSheet>
          ),
        }}
        views={{
          expanded: <span>views</span>,
          collapsed: (
            <IconSheet icon={Search} label={hub.mobileControls.viewLabel} sheetTitle={hub.mobileControls.viewLabel}>
              <span>views</span>
            </IconSheet>
          ),
        }}
        action={{
          labeled: <a href="/hub/tell">{hub.stories.tellTitle}</a>,
          iconified: <a href="/hub/tell" aria-label={hub.mobileControls.tellAria}>T</a>,
        }}
      />,
    );

    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-search")).toBe("collapsed-icon");
    expect(row?.getAttribute("data-filters")).toBe("none");
    expect(screen.getByRole("button", { name: hub.mobileControls.searchLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: hub.mobileControls.filterLabel })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.searchLabel }));
    const dialog = screen.getByRole("dialog", { name: hub.mobileControls.searchLabel });
    expect(within(dialog).getByRole("searchbox", { name: hub.browse.searchPlaceholder })).toBeTruthy();
  });

  it("StoriesSurface collapsed Search wiring uses Search copy (integration with forceWidths)", () => {
    // Render StoriesSurface through HubProgressiveControlRow by mocking widths via a narrow force —
    // StoriesSurface does not expose force props; assert Search label is what Stories passes by
    // opening the collapsed path through a direct IconSheet contract already covered above, and here
    // assert the Stories surface never mounts a Filter-labeled control.
    render(<StoriesSurface {...twoFamily} />);
    expect(screen.queryByRole("button", { name: hub.mobileControls.filterLabel })).toBeNull();
    // Wide default expansion: search field is inline (searchbox), not a Filter icon.
    expect(screen.getByRole("searchbox", { name: hub.browse.searchPlaceholder })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.browse.modeFeed })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.browse.modeTimeline })).toBeTruthy();
  });

  it("omits Family when the viewer has a single family; omits Views while searching", () => {
    render(
      <StoriesSurface {...base} activeFamilies={[fam("f1", "Marino")]} chipSelected={"all"} />,
    );
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-family")).toBe("none");
    expect(screen.queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: hub.browse.searchPlaceholder }), {
      target: { value: "naples" },
    });
    expect(document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-views")).toBe(
      "none",
    );
  });

  it("keeps Tell outside the browse row as the trailing action", () => {
    render(<StoriesSurface {...twoFamily} />);
    expect(screen.getByRole("link", { name: hub.stories.tellTitle })).toBeTruthy();
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-action"),
    ).toBe("labeled");
  });

  it("badges collapsed Search while searching and never badges Views", () => {
    render(
      <HubProgressiveControlRow
        forceAvailableWidth={100}
        forceWidths={{
          search: { expanded: 220, collapsedIcon: 48 },
          views: { expanded: 160, collapsedIcon: 48 },
        }}
        search={{
          expanded: <input type="search" aria-label={hub.browse.searchPlaceholder} defaultValue="x" />,
          collapsed: (
            <IconSheet
              icon={Search}
              label={hub.mobileControls.searchLabel}
              sheetTitle={hub.mobileControls.searchLabel}
              badgeCount={1}
            >
              <input type="search" aria-label={hub.browse.searchPlaceholder} />
            </IconSheet>
          ),
        }}
        views={{
          expanded: <span>views</span>,
          collapsed: (
            <IconSheet icon={Search} label={hub.mobileControls.viewLabel} sheetTitle={hub.mobileControls.viewLabel}>
              <span>views</span>
            </IconSheet>
          ),
        }}
      />,
    );
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-search")).toBe("collapsed-icon");
    expect(row?.getAttribute("data-views")).toBe("collapsed-icon");
    const badgePhrase = hub.mobileControls.activeCountAria(1);
    expect(
      screen.getByRole("button", { name: new RegExp(hub.mobileControls.searchLabel) }).getAttribute(
        "aria-label",
      ),
    ).toContain(badgePhrase);
    expect(
      screen.getByRole("button", { name: hub.mobileControls.viewLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.viewLabel);
  });

  it("badges collapsed Family when the chip selection is a SUBSET, not when 'all' (mirrors StoriesSurface's badgeCount={chipsFiltered ? 1 : 0} wiring)", () => {
    // StoriesSurface does not expose force props, so this drives HubProgressiveControlRow directly
    // with the exact Family IconSheet wiring StoriesSurface uses (see chipsFiltered in
    // StoriesSurface.tsx) — regression coverage lost when stories-surface-strip.test.tsx was deleted.
    const activeFamilies = [fam("f1", "Marino"), fam("f2", "Esposito")];
    function chipsFilteredFor(chipSelected: string[] | "all"): boolean {
      return (
        activeFamilies.length >= 2 &&
        chipSelected !== "all" &&
        chipSelected.length !== activeFamilies.length
      );
    }
    function renderFamily(chipSelected: string[] | "all") {
      const chipsFiltered = chipsFilteredFor(chipSelected);
      return render(
        <HubProgressiveControlRow
          forceAvailableWidth={100}
          forceWidths={{ family: { expanded: 200, collapsedIcon: 48 } }}
          family={{
            expanded: <span>families</span>,
            collapsed: (
              <IconSheet
                icon={Search}
                label={hub.mobileControls.familyLabel}
                sheetTitle={hub.mobileControls.familyLabel}
                badgeCount={chipsFiltered ? 1 : 0}
              >
                <span>families</span>
              </IconSheet>
            ),
          }}
        />,
      );
    }

    const badgePhrase = hub.mobileControls.activeCountAria(1);

    // Subset: only f1 of the two families selected → Family badge.
    const subset = renderFamily(["f1"]);
    const row1 = document.querySelector("[data-hub-progressive-control-row]");
    expect(row1?.getAttribute("data-family")).toBe("collapsed-icon");
    expect(
      screen.getByRole("button", { name: new RegExp(hub.mobileControls.familyLabel) }).getAttribute(
        "aria-label",
      ),
    ).toContain(badgePhrase);
    subset.unmount();

    // All selected → no badge.
    renderFamily("all");
    expect(
      screen.getByRole("button", { name: hub.mobileControls.familyLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.familyLabel);
  });

  it("renders draft reminders below the progressive row", () => {
    render(
      <StoriesSurface
        {...twoFamily}
        selfDrafts={[{ storyId: "s1", kind: "text", recordedAt: new Date().toISOString() }]}
      />,
    );
    expect(screen.getByRole("button", { name: /draft/i })).toBeTruthy();
  });
});
