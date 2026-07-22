// @vitest-environment jsdom
/**
 * KinList — Family tab List (#283): browse-only searchable people index with Member vs tree-only
 * badges. Search filters by name, relation, or membership badge; empty / no-match states; deceased
 * marked "In memory". No Place / Not-family / Remove / governable-edge controls live here.
 *
 * Issue #266 — Phase-2 skin signatures: module classes on rows + CSS-source guards for data-skin /
 * reduce-motion / solemn (mirrors QuestionsTab.test.tsx; intensity stays restrained — no tape/tilt).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import type { FamilyListPerson } from "@/lib/family-list-people";
import { KinList } from "@/app/hub/tabs/KinList";
import styles from "@/app/hub/tabs/KinList.module.css";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../app/hub/tabs/KinList.module.css"), "utf8");

afterEach(cleanup);

function person(over: Partial<FamilyListPerson> & { personId: string }): FamilyListPerson {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    membership: over.membership ?? "member",
    relation: "relation" in over ? (over.relation ?? null) : "parent",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    sex: over.sex ?? "unknown",
  };
}

const PEOPLE: FamilyListPerson[] = [
  person({ personId: "eleanor", displayName: "Eleanor", membership: "tree-only", relation: "parent" }),
  person({ personId: "marco", displayName: "Marco", membership: "member", relation: "sibling" }),
  person({
    personId: "sofia",
    displayName: "Sofia",
    membership: "member",
    relation: "child",
    lifeStatus: "deceased",
  }),
  person({ personId: "rosa", displayName: "Rosa", membership: "member", relation: null }),
];

describe("KinList", () => {
  it("lists every person with membership-first badge and optional relation chip", () => {
    render(<KinList people={PEOPLE} />);
    expect(screen.getByText("Eleanor")).toBeTruthy();
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.getByText("Sofia")).toBeTruthy();
    expect(screen.getByText("Rosa")).toBeTruthy();
    expect(screen.getByTestId("family-list-badge-eleanor").textContent).toBe(
      hub.kin.membershipBadge.treeOnly,
    );
    expect(screen.getByTestId("family-list-badge-marco").textContent).toBe(
      hub.kin.membershipBadge.member,
    );
    expect(screen.getByText(hub.kin.relationLabel.parent)).toBeTruthy();
    // Unplaced member has badge but no relation chip.
    expect(screen.getByTestId("family-list-row-rosa").textContent).not.toMatch(/Parent|Sibling|Child/);
  });

  it("marks a deceased relative 'In memory'", () => {
    render(<KinList people={PEOPLE} />);
    expect(screen.getByText(new RegExp(hub.kin.deceased))).toBeTruthy();
  });

  it("filters by name", () => {
    render(<KinList people={PEOPLE} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "marc" },
    });
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.queryByText("Eleanor")).toBeNull();
    expect(screen.queryByText("Sofia")).toBeNull();
  });

  it("filters by relation label", () => {
    render(<KinList people={PEOPLE} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "sibling" },
    });
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.queryByText("Eleanor")).toBeNull();
  });

  it("filters by membership badge label", () => {
    render(<KinList people={PEOPLE} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "tree-only" },
    });
    expect(screen.getByText("Eleanor")).toBeTruthy();
    expect(screen.queryByText("Marco")).toBeNull();
    expect(screen.queryByText("Rosa")).toBeNull();
  });

  it("shows a no-match note when the query excludes everyone", () => {
    render(<KinList people={PEOPLE} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(hub.kin.searchNoResults("zzz"))).toBeTruthy();
  });

  it("shows the empty note when there are no people at all", () => {
    render(<KinList people={[]} />);
    expect(screen.getByText(hub.kin.empty)).toBeTruthy();
  });

  it("renders an unidentified placeholder from its relation, not a name", () => {
    render(
      <KinList
        people={[
          person({
            personId: "x",
            displayName: null,
            identified: false,
            membership: "tree-only",
            relation: "grandparent",
          }),
        ]}
      />,
    );
    expect(screen.getByText(hub.kin.unknownOf(hub.kin.relationLabel.grandparent))).toBeTruthy();
  });

  it("renders no Place / Not-family / Remove mutation affordances", () => {
    render(<KinList people={PEOPLE} />);
    expect(screen.queryByTestId("unplaced-place-rosa")).toBeNull();
    expect(screen.queryByTestId("unplaced-nonfamily-rosa")).toBeNull();
    expect(screen.queryByTestId("unplaced-remove-rosa")).toBeNull();
    expect(screen.queryByTestId("family-gov-edges")).toBeNull();
    expect(screen.queryByText(hub.unplaced.place)).toBeNull();
    expect(screen.queryByText(hub.unplaced.leaveNonFamily)).toBeNull();
  });

  // #330 — a row opens PersonDetails via the caller's `onSelectPerson`; without it, rows stay inert.
  describe("row activation (#330)", () => {
    it("without onSelectPerson, a row is a plain inert list item (no button)", () => {
      render(<KinList people={PEOPLE} />);
      const row = screen.getByTestId("family-list-row-marco");
      expect(row.tagName).toBe("LI");
      expect(screen.queryByRole("button", { name: /Marco/ })).toBeNull();
    });

    it("with onSelectPerson, a row is a real button and clicking it calls back with the full person", () => {
      const onSelectPerson = vi.fn();
      render(<KinList people={PEOPLE} onSelectPerson={onSelectPerson} />);
      const row = screen.getByTestId("family-list-row-marco");
      expect(row.tagName).toBe("BUTTON");
      fireEvent.click(row);
      expect(onSelectPerson).toHaveBeenCalledTimes(1);
      expect(onSelectPerson).toHaveBeenCalledWith(
        expect.objectContaining({ personId: "marco", displayName: "Marco" }),
      );
    });

    it("a button row is keyboard-activatable (native <button> semantics)", () => {
      const onSelectPerson = vi.fn();
      render(<KinList people={PEOPLE} onSelectPerson={onSelectPerson} />);
      const row = screen.getByTestId("family-list-row-marco") as HTMLButtonElement;
      row.focus();
      expect(document.activeElement).toBe(row);
      fireEvent.click(row); // jsdom doesn't synthesize Enter→click on buttons; assert the semantics.
      expect(onSelectPerson).toHaveBeenCalledTimes(1);
    });

    it("selecting a different row after a search filter still resolves the right person", () => {
      const onSelectPerson = vi.fn();
      render(<KinList people={PEOPLE} onSelectPerson={onSelectPerson} />);
      fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
        target: { value: "eleanor" },
      });
      fireEvent.click(screen.getByTestId("family-list-row-eleanor"));
      expect(onSelectPerson).toHaveBeenCalledWith(
        expect.objectContaining({ personId: "eleanor", membership: "tree-only" }),
      );
    });
  });
});

describe("KinList — Scrapbook signature (#266)", () => {
  it("renders rows / search / relation with module classes", () => {
    render(<KinList people={PEOPLE} />);
    expect(screen.getByRole("searchbox", { name: hub.kin.searchAria }).className).toContain(
      styles.search,
    );
    const name = screen.getByText("Eleanor");
    expect(name.className).toContain(styles.name);
    expect(name.closest("li")!.className).toContain(styles.row);
    expect(screen.getByText(hub.kin.relationLabel.parent).className).toContain(styles.relation);
  });

  it("renders the empty card with the module empty class", () => {
    const { container } = render(<KinList people={[]} />);
    expect(container.querySelector(`.${styles.empty}`)).toBeTruthy();
  });

  it("KinList.module.css declares the restrained Scrapbook signature block", () => {
    expect(css).toContain(':global(:root[data-skin="scrapbook"])');
    expect(css).toContain("var(--shadow-lift)");
    expect(css).toContain("var(--sticker-sky-bg)");
    // Dense-list guardrail: no full-scrapbook markers (tape / tilt / highlighter).
    expect(css).not.toContain("var(--tape-bg)");
    expect(css).not.toMatch(/--tilt/);
    expect(css).not.toContain("var(--highlighter)");
  });

  it("KinList.module.css declares the reduce-motion + solemn suppression block", () => {
    expect(css).toContain(':global(:root[data-reduce-motion="on"])');
    expect(css).toContain(':global(:root[data-skin="scrapbook"] [data-tone="solemn"])');
    expect(css).toMatch(/transform:\s*none/);
    // Sticker chip (relation) must reset under both axes — not only the hover-lift.
    expect(css).toMatch(
      /:global\(:root\[data-reduce-motion="on"\]\) \.relation[\s\S]*?background:\s*none/,
    );
    expect(css).toMatch(
      /:global\(:root\[data-skin="scrapbook"\] \[data-tone="solemn"\]\) \.relation[\s\S]*?background:\s*none/,
    );
  });
});
