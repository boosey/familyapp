// @vitest-environment jsdom
/**
 * KinList — the Family tab's List view (2026-07-14). A read-only, searchable list of the viewer's
 * relatives (the old /hub/kin list, folded into the tab). The search box filters by name OR relation;
 * empty list and no-match states each show their own note; a deceased relative is marked "In memory".
 *
 * Issue #266 — Phase-2 skin signatures: module classes on rows + CSS-source guards for data-skin /
 * reduce-motion / solemn (mirrors QuestionsTab.test.tsx; intensity stays restrained — no tape/tilt).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinListEntry } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KinList } from "@/app/hub/tabs/KinList";
import styles from "@/app/hub/tabs/KinList.module.css";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../app/hub/tabs/KinList.module.css"), "utf8");

afterEach(cleanup);

function entry(over: Partial<KinListEntry> & { personId: string }): KinListEntry {
  return {
    personId: over.personId,
    relation: over.relation ?? "parent",
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
  };
}

const KIN: KinListEntry[] = [
  entry({ personId: "eleanor", displayName: "Eleanor", relation: "parent" }),
  entry({ personId: "marco", displayName: "Marco", relation: "sibling" }),
  entry({ personId: "sofia", displayName: "Sofia", relation: "child", lifeStatus: "deceased" }),
];

describe("KinList", () => {
  it("lists every relative with its relation label", () => {
    render(<KinList kin={KIN} />);
    expect(screen.getByText("Eleanor")).toBeTruthy();
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.getByText("Sofia")).toBeTruthy();
    // Relation labels appear (parent/sibling/child).
    expect(screen.getByText(hub.kin.relationLabel.parent)).toBeTruthy();
  });

  it("marks a deceased relative 'In memory'", () => {
    render(<KinList kin={KIN} />);
    expect(screen.getByText(new RegExp(hub.kin.deceased))).toBeTruthy();
  });

  it("filters by name", () => {
    render(<KinList kin={KIN} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "marc" },
    });
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.queryByText("Eleanor")).toBeNull();
    expect(screen.queryByText("Sofia")).toBeNull();
  });

  it("filters by relation label", () => {
    render(<KinList kin={KIN} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "sibling" },
    });
    expect(screen.getByText("Marco")).toBeTruthy();
    expect(screen.queryByText("Eleanor")).toBeNull();
  });

  it("shows a no-match note when the query excludes everyone", () => {
    render(<KinList kin={KIN} />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(hub.kin.searchNoResults("zzz"))).toBeTruthy();
  });

  it("shows the empty note when there are no relatives at all", () => {
    render(<KinList kin={[]} />);
    expect(screen.getByText(hub.kin.empty)).toBeTruthy();
  });

  it("renders an unidentified placeholder from its relation, not a name", () => {
    render(<KinList kin={[entry({ personId: "x", displayName: null, identified: false, relation: "grandparent" })]} />);
    expect(screen.getByText(hub.kin.unknownOf(hub.kin.relationLabel.grandparent))).toBeTruthy();
  });
});

describe("KinList — playful signature (#266)", () => {
  it("renders rows / search / relation with module classes", () => {
    render(<KinList kin={KIN} />);
    expect(screen.getByRole("searchbox", { name: hub.kin.searchAria }).className).toContain(
      styles.search,
    );
    const name = screen.getByText("Eleanor");
    expect(name.className).toContain(styles.name);
    expect(name.closest("li")!.className).toContain(styles.row);
    expect(screen.getByText(hub.kin.relationLabel.parent).className).toContain(styles.relation);
  });

  it("renders the empty card with the module empty class", () => {
    const { container } = render(<KinList kin={[]} />);
    expect(container.querySelector(`.${styles.empty}`)).toBeTruthy();
  });

  it("KinList.module.css declares the restrained playful signature block", () => {
    expect(css).toContain(':global(:root[data-skin="playful"])');
    expect(css).toContain("var(--shadow-lift)");
    expect(css).toContain("var(--sticker-sky-bg)");
    // Dense-list guardrail: no full-scrapbook markers (tape / tilt / highlighter).
    expect(css).not.toContain("var(--tape-bg)");
    expect(css).not.toMatch(/--tilt/);
    expect(css).not.toContain("var(--highlighter)");
  });

  it("KinList.module.css declares the reduce-motion + solemn suppression block", () => {
    expect(css).toContain(':global(:root[data-reduce-motion="on"])');
    expect(css).toContain(':global(:root[data-skin="playful"] [data-tone="solemn"])');
    expect(css).toMatch(/transform:\s*none/);
    // Sticker chip (relation) must reset under both axes — not only the hover-lift.
    expect(css).toMatch(
      /:global\(:root\[data-reduce-motion="on"\]\) \.relation[\s\S]*?background:\s*none/,
    );
    expect(css).toMatch(
      /:global\(:root\[data-skin="playful"\] \[data-tone="solemn"\]\) \.relation[\s\S]*?background:\s*none/,
    );
  });
});
