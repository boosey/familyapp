// @vitest-environment jsdom
/**
 * Behavior tests for the Asks Family DESIGNATOR (ADR-0021, issue #50). (The Requests surface no longer
 * uses a designator — since #159 it scopes via the URL-driven `?families=` filter, tested at
 * FamilyChips / RequestsTab instead.)
 *
 * This client wrapper is SEEDED from the browse filter `?families=` but holds its own state and
 * NEVER write it back. We assert:
 *   - SEED: the initial designated family comes from the seed (a real seed wins; "all"/unknown → first).
 *   - LIST SCOPING: only the designated family's rows show; switching the designator changes which rows
 *     show WITHOUT any router.push (the shared next/navigation mock's `push` is asserted un-called).
 *   - FAMILY-LESS ASKS: an ask with `familyIds: []` stays visible under EVERY designated family.
 *
 * next/navigation is mocked the same way family-chips.test.tsx does so FamilyChips (a client component
 * using useRouter/usePathname/useSearchParams) renders; `push` doubles as the no-write-back sentinel.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AsksDesignator, type AsksDesignatorAsk } from "@/app/hub/tabs/AsksDesignator";
import askStyles from "@/app/hub/tabs/AsksDesignator.module.css";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
];

function ask(id: string, familyIds: string[], questionText: string): AsksDesignatorAsk {
  return {
    id,
    questionText,
    status: "queued",
    storyId: null,
    targetSpokenName: "Nonna",
    familyIds,
    storyVisible: false,
    storyTitle: null,
  };
}

describe("AsksDesignator — seed + list scoping (no write-back)", () => {
  const asks = [
    ask("a1", ["fam-a"], "Q about Esposito"),
    ask("a2", ["fam-b"], "Q about Marino"),
  ];

  it("SEED: a concrete family seed designates that family's asks", () => {
    render(<AsksDesignator families={FAMILIES} seedFamilyId="fam-b" asks={asks} />);
    expect(screen.getByRole("button", { name: "Marino" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText(/Q about Marino/)).toBeTruthy();
    expect(screen.queryByText(/Q about Esposito/)).toBeNull();
  });

  it("SEED: an 'all' seed falls back to the FIRST family", () => {
    render(<AsksDesignator families={FAMILIES} seedFamilyId="all" asks={asks} />);
    expect(screen.getByRole("button", { name: "Esposito" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText(/Q about Esposito/)).toBeTruthy();
    expect(screen.queryByText(/Q about Marino/)).toBeNull();
  });

  it("SEED: an unknown seed id falls back to the FIRST family", () => {
    render(<AsksDesignator families={FAMILIES} seedFamilyId="fam-zzz" asks={asks} />);
    expect(screen.getByRole("button", { name: "Esposito" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("LIST SCOPING: switching the designator changes the list WITHOUT a router.push", () => {
    render(<AsksDesignator families={FAMILIES} seedFamilyId="fam-a" asks={asks} />);
    expect(screen.queryByText(/Q about Esposito/)).toBeTruthy();
    expect(screen.queryByText(/Q about Marino/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Marino" }));

    expect(screen.queryByText(/Q about Marino/)).toBeTruthy();
    expect(screen.queryByText(/Q about Esposito/)).toBeNull();
    // The load-bearing guarantee: designating never rewrites the browse filter.
    expect(push).not.toHaveBeenCalled();
  });

  it("FAMILY-LESS ASKS: an ask with no family stays visible under EVERY designated family", () => {
    const withOrphan = [...asks, ask("a3", [], "Orphan ask")];
    render(<AsksDesignator families={FAMILIES} seedFamilyId="fam-a" asks={withOrphan} />);
    // Under fam-a: fam-a ask + the orphan; NOT the fam-b ask.
    expect(screen.queryByText(/Orphan ask/)).toBeTruthy();
    expect(screen.queryByText(/Q about Esposito/)).toBeTruthy();
    expect(screen.queryByText(/Q about Marino/)).toBeNull();

    // Switch to fam-b: fam-b ask + the orphan still show.
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    expect(screen.queryByText(/Orphan ask/)).toBeTruthy();
    expect(screen.queryByText(/Q about Marino/)).toBeTruthy();
    expect(screen.queryByText(/Q about Esposito/)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("one-family viewer: no chip bar, the sole family's asks show", () => {
    render(
      <AsksDesignator
        families={[FAMILIES[0]!]}
        seedFamilyId="fam-a"
        asks={[ask("a1", ["fam-a"], "Q about Esposito")]}
      />,
    );
    expect(screen.queryByRole("group", { name: "Choose a family" })).toBeNull();
    expect(screen.queryByText(/Q about Esposito/)).toBeTruthy();
  });
});

describe("AsksDesignator — Scrapbook signature (issue #208)", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/hub/tabs/AsksDesignator.module.css"),
    "utf8",
  );

  it("renders ask cards with the module card + question classes and an inline --tilt", () => {
    const { container } = render(
      <AsksDesignator
        families={[FAMILIES[0]!]}
        seedFamilyId="fam-a"
        asks={[ask("a1", ["fam-a"], "Q about Esposito")]}
      />,
    );
    const card = container.querySelector("li") as HTMLElement;
    expect(card.className).toContain(askStyles.card);
    expect(card.style.getPropertyValue("--tilt")).toBe("0.55deg");
    expect(container.querySelector(`.${askStyles.question}`)).toBeTruthy();
  });

  it("stickerizes the status pill on a not-yet-listenable ask", () => {
    const { container } = render(
      <AsksDesignator
        families={[FAMILIES[0]!]}
        seedFamilyId="fam-a"
        asks={[ask("a1", ["fam-a"], "Q about Esposito")]}
      />,
    );
    expect(container.querySelector(`.${askStyles.status}`)).toBeTruthy();
  });

  it("module CSS declares the Scrapbook signature + suppression blocks", () => {
    expect(css).toContain(':global(:root[data-skin="scrapbook"])');
    expect(css).toMatch(/rotate\(var\(--tilt/);
    expect(css).toContain("var(--tape-bg)");
    expect(css).toContain("var(--highlighter)");
    expect(css).toContain("var(--shadow-lift)");
    // Suppression under reduce-motion OR solemn.
    expect(css).toContain(':global(:root[data-reduce-motion="on"])');
    expect(css).toContain(':global([data-tone="solemn"])');
    expect(css).toMatch(/transform:\s*none/);
    expect(css).toMatch(/background-image:\s*none/);
  });
});
