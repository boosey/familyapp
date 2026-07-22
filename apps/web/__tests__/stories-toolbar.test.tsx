// @vitest-environment jsdom
/**
 * Stories tab control chrome (#190 behaviour, #301 layout) — progressive hub control row.
 *
 * One row: Sub tabs (Feed/Timeline) → Family → Search → Views, with Tell trailing. Reminders sit
 * below the row. Behaviour (search filtering, view toggle, family narrowing, draft resume) is
 * unchanged from #190; placement moved off the two-row HubToolbar onto HubProgressiveControlRow.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";
import { hub } from "@/app/_copy";
import progressiveStyles from "@/app/hub/HubProgressiveControlRow.module.css";
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

function progressiveRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector("[data-hub-progressive-control-row]");
  if (!row) throw new Error("expected HubProgressiveControlRow");
  return row as HTMLElement;
}

describe("StoriesTab controls (#301) — progressive control row", () => {
  it("renders browse mode pills as shared HubSubNav pills (Feed/Timeline only) in the row", () => {
    const { container } = renderPopulated();
    const row = progressiveRow(container);
    const nav = row.querySelector("nav[aria-label]");
    expect(nav).toBeTruthy();
    for (const label of [hub.browse.modeFeed, hub.browse.modeTimeline]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // Search is no longer a mode pill — it's a persistent field (asserted below).
    expect(screen.queryByRole("button", { name: hub.browse.modeSearch })).toBeNull();
  });

  it("puts 'Tell a story' in the trailing action slot", () => {
    const { container } = renderPopulated();
    const tell = screen.getByRole("link", { name: hub.stories.tellTitle });
    expect(tell.getAttribute("href")).toBe("/hub/tell");
    const actionSlot = tell.closest(`.${progressiveStyles.action}`);
    expect(actionSlot).toBeTruthy();
    expect(progressiveRow(container).contains(tell)).toBe(true);
    expect(progressiveRow(container).getAttribute("data-action")).toBe("labeled");
  });

  it("places family selector chips in the progressive row when ≥2 families", () => {
    const { container } = renderPopulated({ activeFamilies: [famA, famB] });
    const chips = screen.getByRole("group", { name: hub.shell.familyFilterAria });
    const row = progressiveRow(container);
    expect(row.contains(chips)).toBe(true);
    expect(row.getAttribute("data-family")).toBe("expanded");
  });

  it("places the Masonry/Column feed-view selector in the progressive row (Feed mode)", () => {
    const { container } = renderPopulated({ activeFamilies: [famA, famB] });
    const viewSel = screen.getByRole("radiogroup", { name: hub.browse.viewSelectorAria });
    const row = progressiveRow(container);
    expect(row.contains(viewSel)).toBe(true);
    expect(row.getAttribute("data-views")).toBe("expanded");
  });

  it("shows the persistent search field in the row whenever browsing (not a mode)", () => {
    const { container } = renderPopulated();
    const input = screen.getByRole("searchbox");
    expect(progressiveRow(container).contains(input)).toBe(true);
    expect(progressiveRow(container).getAttribute("data-search")).toBe("expanded");
  });

  it("typing in the persistent field filters the pool (search replaces the feed/timeline body)", () => {
    renderPopulated();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "storm" } });
    const titles = screen
      .queryAllByRole("link")
      .map((el) => el.textContent ?? "")
      .filter((t) => t.includes("Story"));
    expect(titles.some((t) => t.includes("Story B"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A"))).toBe(false);
  });

  it("hides the Masonry/Column selector outside Feed mode", () => {
    const { container } = renderPopulated({ activeFamilies: [famA] });
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeTimeline }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
    expect(progressiveRow(container).getAttribute("data-views")).toBe("none");
  });

  it("omits Views while searching (single-family viewer has no Family unit either)", () => {
    const { container } = renderPopulated({ activeFamilies: [famA] });
    expect(progressiveRow(container).getAttribute("data-family")).toBe("none");
    expect(progressiveRow(container).getAttribute("data-views")).toBe("expanded");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "storm" } });
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
    expect(progressiveRow(container).getAttribute("data-views")).toBe("none");
  });

  it("keeps draft + intake reminders below the progressive row (not competing with browse units)", () => {
    const { container } = renderPopulated({
      intakeIncomplete: true,
      selfDrafts: [{ storyId: "d1", kind: "text", recordedAt: new Date().toISOString() }],
    });
    const draft = screen.getByRole("button", { name: /draft/i });
    const intake = screen.getByRole("link", { name: hub.intake.aria });
    const row = progressiveRow(container);
    expect(row.contains(draft)).toBe(false);
    expect(row.contains(intake)).toBe(false);
    const below = draft.closest(`.${progressiveStyles.belowRow}`);
    expect(below).toBeTruthy();
    expect(below!.contains(intake)).toBe(true);
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

  it("uses the shared pill CSS in the progressive row, not a bespoke Stories pill row", () => {
    const { container } = renderPopulated();
    const pill = screen.getByRole("button", { name: hub.browse.modeFeed });
    expect(pill.className).toContain(segStyles.pill);
    expect(pill.closest(`.${segStyles.group}`)).toBeTruthy();
    expect(progressiveRow(container).contains(pill)).toBe(true);
  });
});

describe("StoriesTab controls (#301) — empty states still show the control row", () => {
  it("all-off (filter=none) keeps the family chips + Tell above the honest empty state", () => {
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
