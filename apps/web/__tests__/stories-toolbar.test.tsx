// @vitest-environment jsdom
/**
 * Issue #190 — the Stories tab is normalized onto the shared two-row HubToolbar (#189):
 *
 *   R1:  [Feed/Timeline/Search pills] [search field]  ·······  [Tell a Story ▸ + reminders]
 *   R2:  [Family selector]                            ·······  [Masonry/Column]
 *
 * These tests pin the HOIST: the Feed/Timeline/Search mode toggle + search field live in R1-left of
 * the toolbar (shared HubSubNav pill style, no bespoke Stories pill), "Tell a story" + draft/intake
 * reminders sit right-justified in R1, the family selector chips move to R2-left, and the
 * Masonry/Column feed-view selector moves to R2-right. Behaviour (search filtering, view toggle,
 * family narrowing) is unchanged — only placement moves — and the empty-row rule holds (a row with no
 * items must not render).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";
import { hub } from "@/app/_copy";
import toolbarStyles from "@/app/hub/HubToolbar.module.css";
import segStyles from "@/app/_kindred/SegmentedControl.module.css";
import type { MemberWithStories } from "@/lib/hub-data";
import type { ViewerFamily } from "@/app/hub/tabs/story-browse-types";

// StoriesTab mounts FamilyChips (≥2 families) + the browse surface — both read next/navigation.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const famA: ViewerFamily = { id: "fam-a", name: "Esposito" };
const famB: ViewerFamily = { id: "fam-b", name: "Marino" };

/** One MemberWithStories slot carrying a single approved story with an era + summary. */
function slot(
  familyId: string,
  familyName: string,
  storyId: string,
  title: string,
  summary: string | null = null,
): MemberWithStories {
  const now = new Date();
  return {
    person: { id: "p1", spokenName: "Eleanor", displayName: "Eleanor" },
    family: { id: familyId, name: familyName },
    stories: [
      {
        id: storyId,
        title,
        summary,
        prose: null,
        tags: [],
        eraYear: 1962,
        eraLabel: null,
        approvedAt: now,
        createdAt: now,
      },
    ],
  } as unknown as MemberWithStories;
}

const baseProps = {
  viewerPersonId: "viewer",
  seenStoryIds: new Set<string>(),
  storyCovers: new Map<string, string>(),
  storyPhotos: new Map<string, string[]>(),
  viewerName: "You",
  selfDrafts: [],
  filter: { kind: "all" } as const,
};

/** Render the Stories tab with a populated feed (so the browse surface + its controls mount). */
function renderPopulated(over: {
  activeFamilies?: ViewerFamily[];
  intakeIncomplete?: boolean;
  selfDrafts?: { storyId: string; kind: "voice" | "text"; recordedAt: string }[];
} = {}) {
  const activeFamilies = over.activeFamilies ?? [famA, famB];
  return render(
    <StoriesTab
      {...baseProps}
      feed={[slot(famA.id, famA.name, "s-A", "Story A", "wedding day"), slot(famB.id, famB.name, "s-B", "Story B", "the storm")]}
      familyTargets={new Map([
        ["s-A", [famA]],
        ["s-B", [famB]],
      ])}
      viewerFamilies={activeFamilies}
      activeFamilies={activeFamilies}
      selfDrafts={over.selfDrafts ?? []}
      intakeIncomplete={over.intakeIncomplete ?? false}
    />,
  );
}

/** The rendered HubToolbar rows (in order). */
function toolbarRows(container: HTMLElement): HTMLElement[] {
  const toolbar = container.querySelector(`.${toolbarStyles.toolbar}`) as HTMLElement | null;
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll(`.${toolbarStyles.row}`)) as HTMLElement[];
}

describe("StoriesTab toolbar (#190) — two-row HubToolbar layout", () => {
  it("renders the browse mode pills as shared HubSubNav pills (Feed/Timeline/Search) in R1", () => {
    const { container } = renderPopulated();
    const rows = toolbarRows(container);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const r1 = rows[0]!;
    // All three mode pills present, in R1, using the shared pill nav (labelled region).
    const nav = r1.querySelector('nav[aria-label]');
    expect(nav).toBeTruthy();
    for (const label of [hub.browse.modeFeed, hub.browse.modeTimeline, hub.browse.modeSearch]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("puts 'Tell a story' right-justified in R1 (the toolbar's right slot)", () => {
    const { container } = renderPopulated();
    const tell = screen.getByRole("link", { name: hub.stories.tellTitle });
    expect(tell.getAttribute("href")).toBe("/hub/tell");
    // It lives in a right-justified toolbar slot on R1.
    const rightSlot = tell.closest(`.${toolbarStyles.right}`);
    expect(rightSlot).toBeTruthy();
    expect(toolbarRows(container)[0]!.contains(tell)).toBe(true);
  });

  it("moves the family selector chips to R2-left", () => {
    const { container } = renderPopulated({ activeFamilies: [famA, famB] });
    const chips = screen.getByRole("group", { name: hub.shell.familyFilterAria });
    const rows = toolbarRows(container);
    expect(rows.length).toBe(2);
    // Chips are in the SECOND row's left slot.
    expect(rows[1]!.contains(chips)).toBe(true);
    expect(chips.closest(`.${toolbarStyles.left}`)).toBeTruthy();
  });

  it("moves the Masonry/Column feed-view selector to R2-right (Feed mode)", () => {
    const { container } = renderPopulated({ activeFamilies: [famA, famB] });
    const viewSel = screen.getByRole("radiogroup", { name: hub.browse.viewSelectorAria });
    const rows = toolbarRows(container);
    expect(rows[1]!.contains(viewSel)).toBe(true);
    expect(viewSel.closest(`.${toolbarStyles.right}`)).toBeTruthy();
  });

  it("shows the search field beside the pills in R1 only when Search mode is active", () => {
    const { container } = renderPopulated();
    // Not in Feed mode.
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeSearch }));
    const input = screen.getByRole("textbox");
    // The search input rides R1 (beside the pills), NOT the content body below the toolbar.
    expect(toolbarRows(container)[0]!.contains(input)).toBe(true);
  });

  it("search still filters the pool as before (behaviour unchanged after the hoist)", () => {
    renderPopulated();
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeSearch }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "storm" } });
    const titles = screen
      .queryAllByRole("link")
      .map((el) => el.textContent ?? "")
      .filter((t) => t.includes("Story"));
    expect(titles.some((t) => t.includes("Story B"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A"))).toBe(false);
  });

  it("hides the Masonry/Column selector outside Feed mode (row collapses, empty-row rule)", () => {
    const { container } = renderPopulated({ activeFamilies: [famA] });
    // Single family → no chips → R2-left empty. In Feed mode R2-right (view selector) keeps R2 alive.
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeTimeline }));
    // Timeline: no view selector, single family → no chips → R2 has no content → row not rendered.
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
    const rows = toolbarRows(container);
    // Only R1 remains.
    expect(rows.length).toBe(1);
  });

  it("does not render R2 at all for a single-family viewer in a mode without a view selector", () => {
    const { container } = renderPopulated({ activeFamilies: [famA] });
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeSearch }));
    // Search mode: no view selector; single family: no chips → R2 empty → collapsed.
    expect(toolbarRows(container).length).toBe(1);
  });

  it("keeps the draft + intake reminders right-justified in R1 beside 'Tell a story'", () => {
    const { container } = renderPopulated({
      intakeIncomplete: true,
      selfDrafts: [{ storyId: "d1", kind: "text", recordedAt: new Date().toISOString() }],
    });
    const draft = screen.getByRole("button", { name: /draft/i });
    const intake = screen.getByRole("link", { name: hub.intake.aria });
    const r1 = toolbarRows(container)[0]!;
    expect(r1.contains(draft)).toBe(true);
    expect(r1.contains(intake)).toBe(true);
    expect(draft.closest(`.${toolbarStyles.right}`)).toBeTruthy();
    expect(intake.closest(`.${toolbarStyles.right}`)).toBeTruthy();
  });

  it("expands the per-draft resume list in place when the draft reminder is clicked", () => {
    renderPopulated({
      selfDrafts: [
        { storyId: "d1", kind: "text", recordedAt: "2026-07-10T12:00:00.000Z" },
        { storyId: "d2", kind: "voice", recordedAt: "2026-07-11T12:00:00.000Z" },
      ],
    });
    const button = screen.getByRole("button", { name: /draft/i });
    // Collapsed by default: no resume links, and aria-controls is absent (no dangling ref).
    expect(screen.queryByRole("link", { name: hub.stories.resume })).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    const listId = button.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    expect(document.getElementById(listId!)).not.toBeNull();

    const resume = screen.getAllByRole("link", { name: hub.stories.resume });
    expect(resume.map((el) => el.getAttribute("href"))).toEqual(["/hub/tell/d1", "/hub/tell/d2"]);
    // Each resume link is described by its OWN per-draft date meta (WCAG 2.4.4), never a shared id.
    const describedBy = resume.map((el) => el.getAttribute("aria-describedby"));
    expect(describedBy[0]).toBeTruthy();
    expect(describedBy[0]).not.toBe(describedBy[1]);
    for (const id of describedBy) expect(document.getElementById(id!)).not.toBeNull();
  });

  it("omits the draft reminder when there are no drafts, and the intake reminder when intake is complete", () => {
    renderPopulated({ activeFamilies: [famA], selfDrafts: [], intakeIncomplete: false });
    expect(screen.queryByRole("button", { name: /draft/i })).toBeNull();
    expect(screen.queryByRole("link", { name: hub.intake.aria })).toBeNull();
    // Tell-a-story is always present.
    expect(screen.getByRole("link", { name: hub.stories.tellTitle })).toBeTruthy();
  });

  it("uses the shared toolbar/pill CSS, not a bespoke Stories pill row", () => {
    renderPopulated();
    // The mode nav is a shared HubSubNav pill row using the ONE boxed pill look (segStyles.pill inside
    // a segStyles.group box — single-sourced with the SegmentedControl view selectors), in a toolbar row.
    const pill = screen.getByRole("button", { name: hub.browse.modeFeed });
    expect(pill.className).toContain(segStyles.pill);
    expect(pill.closest(`.${segStyles.group}`)).toBeTruthy();
    expect(pill.closest(`.${toolbarStyles.row}`)).toBeTruthy();
  });
});

describe("StoriesTab toolbar (#190) — empty states still show the toolbar", () => {
  it("all-off (filter=none) keeps the family chips (R2) + Tell (R1) above the honest empty state", () => {
    render(
      <StoriesTab
        {...baseProps}
        feed={[slot(famA.id, famA.name, "s-A", "Story A")]}
        familyTargets={new Map([["s-A", [famA]]])}
        viewerFamilies={[famA, famB]}
        activeFamilies={[famA, famB]}
        filter={{ kind: "none" }}
      />,
    );
    expect(screen.getByText(hub.stories.noFamiliesSelected)).toBeTruthy();
    // The family selector stays so the viewer can turn a family back on.
    expect(screen.getByRole("group", { name: hub.shell.familyFilterAria })).toBeTruthy();
    // Tell-a-story is still the entry point.
    expect(screen.getByRole("link", { name: hub.stories.tellTitle })).toBeTruthy();
  });

  it("empty feed still shows 'Tell a story' (the entry point) above the welcoming empty note", () => {
    render(
      <StoriesTab
        {...baseProps}
        feed={[]}
        familyTargets={new Map()}
        viewerFamilies={[]}
        activeFamilies={[]}
      />,
    );
    expect(screen.getByRole("link", { name: hub.stories.tellTitle }).getAttribute("href")).toBe(
      "/hub/tell",
    );
  });
});
