// @vitest-environment jsdom
/**
 * Behavior test for <FamilyChips> — the shared browse-filter chip bar (ADR-0021, FILTER mode).
 *
 * Asserts: renders nothing for <2 families; renders N chips for ≥2 with correct aria-pressed for the
 * "all" / subset / [] states; clicking a chip in the "all" state pushes `?families=<the other ids>`;
 * deselecting the last ON chip pushes `?families=none`; turning the final OFF chip back ON (reaching
 * the full set) OMITS the param. next/navigation is mocked the same way hub-tabs.test.tsx does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FamilyChips } from "@/app/hub/FamilyChips";

const push = vi.fn();
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  currentSearch = "";
});

const FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
  { id: "fam-c", name: "Rossi" },
];

describe("FamilyChips", () => {
  it("renders nothing for a one-family viewer", () => {
    const { container } = render(
      <FamilyChips families={[FAMILIES[0]!]} selected="all" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a family-less viewer", () => {
    const { container } = render(<FamilyChips families={[]} selected="all" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per family for ≥2 families", () => {
    render(<FamilyChips families={FAMILIES} selected="all" />);
    expect(screen.getByRole("button", { name: "Esposito" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Marino" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rossi" })).toBeTruthy();
  });

  it("marks every chip pressed when selected is 'all'", () => {
    render(<FamilyChips families={FAMILIES} selected="all" />);
    for (const name of ["Esposito", "Marino", "Rossi"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("reflects a subset selection in aria-pressed", () => {
    render(<FamilyChips families={FAMILIES} selected={["fam-b"]} />);
    expect(screen.getByRole("button", { name: "Esposito" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Marino" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Rossi" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("marks every chip un-pressed when selected is []", () => {
    render(<FamilyChips families={FAMILIES} selected={[]} />);
    for (const name of ["Esposito", "Marino", "Rossi"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("clicking a chip in the 'all' state narrows to ?families=<the other ids>", () => {
    render(<FamilyChips families={FAMILIES} selected="all" />);
    // Turn Marino OFF → the remaining ON set is A + C, in active-set order.
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    expect(push).toHaveBeenCalledWith("/hub?families=fam-a%2Cfam-c");
  });

  it("deselecting the last ON chip pushes ?families=none", () => {
    render(<FamilyChips families={FAMILIES} selected={["fam-b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    expect(push).toHaveBeenCalledWith("/hub?families=none");
  });

  it("turning the final OFF chip back ON (full set) OMITS the param", () => {
    // A + B are on; turning C on reaches the full set → param omitted.
    render(<FamilyChips families={FAMILIES} selected={["fam-a", "fam-b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Rossi" }));
    expect(push).toHaveBeenCalledWith("/hub");
  });

  it("preserves other search params (tab) when toggling", () => {
    currentSearch = "tab=album";
    render(<FamilyChips families={FAMILIES} selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    const url = push.mock.calls[0]![0] as string;
    const parsed = new URL(url, "https://example.test");
    expect(parsed.searchParams.get("tab")).toBe("album");
    expect(parsed.searchParams.get("families")).toBe("fam-a,fam-c");
  });

  it("exposes the group with the family-filter aria label", () => {
    render(<FamilyChips families={FAMILIES} selected="all" />);
    expect(screen.getByRole("group", { name: "Filter by family" })).toBeTruthy();
  });
});

describe("FamilyChips — DESIGNATOR mode (ADR-0021, single-select, no write-back)", () => {
  it("renders nothing for a one-family viewer (nothing to designate)", () => {
    const { container } = render(
      <FamilyChips families={[FAMILIES[0]!]} value="fam-a" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("marks exactly the designated chip pressed (single-select)", () => {
    render(<FamilyChips families={FAMILIES} value="fam-b" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Esposito" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Marino" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Rossi" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("exposes the group with the family-designator aria label", () => {
    render(<FamilyChips families={FAMILIES} value="fam-a" onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: "Choose a family" })).toBeTruthy();
  });

  // THE load-bearing test: selecting a different family fires onSelect but NEVER writes the URL.
  it("selecting a different chip calls onSelect and does NOT push to the router (no write-back)", () => {
    const onSelect = vi.fn();
    render(<FamilyChips families={FAMILIES} value="fam-a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    expect(onSelect).toHaveBeenCalledWith("fam-b");
    // The designator must never touch the browse filter — assert no router.push at all.
    expect(push).not.toHaveBeenCalled();
  });

  it("clicking the already-designated chip is a no-op (no onSelect, no push)", () => {
    const onSelect = vi.fn();
    render(<FamilyChips families={FAMILIES} value="fam-a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Esposito" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // Contrast: FILTER mode DOES push — proving the two modes differ and the no-write-back is real.
  it("CONTRAST: filter mode DOES push on the same interaction", () => {
    render(<FamilyChips families={FAMILIES} selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Marino" }));
    expect(push).toHaveBeenCalled();
  });
});
