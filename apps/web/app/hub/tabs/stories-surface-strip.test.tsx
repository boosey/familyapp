// @vitest-environment jsdom
/**
 * ADR-0025 Phase B, Increment 3 Step A — the Stories COMPACT control strip. On a phone StoriesSurface
 * renders: visible Feed/Timeline pills + up to three labeled icon-sheets [View][Family][Filter] + an
 * iconified Tell action; each icon appears ONLY when its content exists. Desktop is unchanged (the inline
 * HubToolbar, labeled Tell). `useIsCompact` + `next/navigation` are mocked (mirroring the other Stories
 * tests) so we can drive each branch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoriesSurface } from "./StoriesSurface";
import { hub } from "@/app/_copy";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({
  useIsCompact: () => compact,
}));

afterEach(() => {
  cleanup();
  compact = false;
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

// A 2-family browsing viewer → View + Family + Filter all present.
const twoFamily = {
  ...base,
  activeFamilies: [fam("f1", "Marino"), fam("f2", "Esposito")],
  chipSelected: "all" as const,
};

describe("StoriesSurface compact strip (Increment 3 Step A)", () => {
  it("desktop renders the inline HubToolbar with a LABELED Tell button and no icon-sheets", () => {
    compact = false;
    render(<StoriesSurface {...twoFamily} />);
    // Labeled Tell (text), not the iconified aria-only button.
    expect(screen.getByRole("link", { name: hub.stories.tellTitle })).toBeTruthy();
    // No per-concern icon-sheet triggers on desktop.
    expect(screen.queryByRole("button", { name: hub.mobileControls.viewLabel })).toBeNull();
    expect(screen.queryByRole("button", { name: hub.mobileControls.filterLabel })).toBeNull();
  });

  it("compact renders visible Feed/Timeline pills + View/Family/Filter icon-sheets + an iconified Tell", () => {
    compact = true;
    render(<StoriesSurface {...twoFamily} />);
    // Visible sub-tab pills (shared HubSubNav → <button> pills, not behind an icon).
    expect(screen.getByRole("button", { name: hub.browse.modeFeed })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.browse.modeTimeline })).toBeTruthy();
    // All three labeled icon-sheet triggers.
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.familyLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
    // Iconified Tell (accessible via aria-label, still linking to /hub/tell).
    const tell = screen.getByRole("link", { name: hub.mobileControls.tellAria });
    expect(tell.getAttribute("href")).toBe("/hub/tell");
  });

  it("compact hides the Family icon for a single-family viewer", () => {
    compact = true;
    render(
      <StoriesSurface {...base} activeFamilies={[fam("f1", "Marino")]} chipSelected={"all"} />,
    );
    expect(screen.queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();
    // View + Filter still present (feed browsing).
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
  });

  it("compact opens the Filter sheet holding the search field when the Filter icon is tapped", () => {
    compact = true;
    render(<StoriesSurface {...twoFamily} />);
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.filterLabel }));
    const dialog = screen.getByRole("dialog", { name: hub.mobileControls.filterLabel });
    // The search field (its accessible name is the browse search placeholder) lives inside the sheet.
    expect(within(dialog).getByRole("searchbox", { name: hub.browse.searchPlaceholder })).toBeTruthy();
  });

  // REGRESSION: the View icon only exists where a layout choice exists — while searching, the feed body
  // it steers is off-screen, so the View icon must not render (ADR-0025: icons render only with content).
  it("compact hides the View icon once the viewer is searching", () => {
    compact = true;
    render(<StoriesSurface {...twoFamily} />);
    // Type into the Filter sheet's search field → searching → the View icon disappears. (Regex name:
    // the Filter icon gains a badge suffix once searching, so match by label substring — Increment 4.)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(hub.mobileControls.filterLabel) }));
    const searchbox = screen.getByRole("searchbox", { name: hub.browse.searchPlaceholder });
    fireEvent.change(searchbox, { target: { value: "naples" } });
    expect(screen.queryByRole("button", { name: new RegExp(hub.mobileControls.viewLabel) })).toBeNull();
    // Family + Filter icons remain.
    expect(screen.getByRole("button", { name: new RegExp(hub.mobileControls.familyLabel) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(hub.mobileControls.filterLabel) })).toBeTruthy();
  });

  // REGRESSION: reminders don't fit inline at 360px — they drop to a full-width row BELOW the strip but
  // stay reachable. Guard that a drafted viewer's reminder still renders on the compact branch.
  it("compact renders the draft reminder in a row below the strip (still reachable)", () => {
    compact = true;
    render(
      <StoriesSurface
        {...twoFamily}
        selfDrafts={[{ storyId: "s1", kind: "text", recordedAt: new Date().toISOString() }]}
      />,
    );
    // The draft reminder button is present (its top line names the draft count).
    expect(screen.getByRole("button", { name: /draft/i })).toBeTruthy();
  });

  // ── ADR-0025 Increment 4 — per-icon active badges ──────────────────────────────────────────────
  // A badged IconSheet trigger's accessible NAME gains the active-count phrase (label-first, e.g.
  // "Filter, 1 filter active"); unbadged it is just the label. So "is it badged?" = its name contains
  // the activeCountAria phrase. View is NEVER badged.
  const badgePhrase = hub.mobileControls.activeCountAria(1);
  const iconByLabel = (label: string) =>
    screen.getByRole("button", { name: new RegExp(label) });

  it("badges the Filter icon only while searching, and never the View icon", () => {
    compact = true;
    render(<StoriesSurface {...twoFamily} />);
    // Idle: the Filter icon name is just its label (no active-count phrase).
    expect(iconByLabel(hub.mobileControls.filterLabel).getAttribute("aria-label")).not.toContain(
      badgePhrase,
    );
    // Search → the Filter icon badges (its name gains the phrase). View hides while searching.
    fireEvent.click(iconByLabel(hub.mobileControls.filterLabel));
    fireEvent.change(screen.getByRole("searchbox", { name: hub.browse.searchPlaceholder }), {
      target: { value: "naples" },
    });
    expect(iconByLabel(hub.mobileControls.filterLabel).getAttribute("aria-label")).toContain(
      badgePhrase,
    );
    expect(screen.queryByRole("button", { name: new RegExp(hub.mobileControls.viewLabel) })).toBeNull();
  });

  it("badges the Family icon when the chip selection is a SUBSET, not when 'all'", () => {
    compact = true;
    // Subset: only f1 of the two families selected → Family badge.
    const { rerender } = render(<StoriesSurface {...twoFamily} chipSelected={["f1"]} />);
    expect(iconByLabel(hub.mobileControls.familyLabel).getAttribute("aria-label")).toContain(
      badgePhrase,
    );
    // All selected → no badge.
    rerender(<StoriesSurface {...twoFamily} chipSelected={"all"} />);
    expect(iconByLabel(hub.mobileControls.familyLabel).getAttribute("aria-label")).not.toContain(
      badgePhrase,
    );
  });

  it("never badges the View icon (a layout choice hides no content)", () => {
    compact = true;
    render(<StoriesSurface {...twoFamily} />);
    // View is never badged → its trigger's accessible name is EXACTLY the label (no active-count phrase).
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel }).getAttribute("aria-label")).toBe(
      hub.mobileControls.viewLabel,
    );
  });
});
