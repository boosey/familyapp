// @vitest-environment jsdom
/**
 * #140 — FamilyChips renders an optional per-family count badge (the shared hub count-pill) when a
 * chip's id maps to a positive count, and nothing when the count is 0/absent. Covered in both the
 * designator and filter modes (the Requests selector is designator mode; the prop is mode-agnostic).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FamilyChips } from "./FamilyChips";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(cleanup);

const FAMILIES = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
// Badge accessible names are PRECOMPUTED, serializable strings keyed by family id — NOT a formatter
// function. A Server Component caller (RequestsTab) cannot pass a function across the RSC boundary, so
// the `badgeLabels` prop must stay plain data (see the regression test below).
const labels = { a: "3 pending", b: "5 pending" };

describe("FamilyChips count badges (#140)", () => {
  it("renders a count badge only on families with a positive count (designator mode)", () => {
    render(
      <FamilyChips
        families={FAMILIES}
        value="a"
        onSelect={() => {}}
        badges={{ a: 3 }}
        badgeLabels={labels}
      />,
    );
    // Alpha carries a badge of 3 with the accessible name; Beta (count 0/absent) carries none.
    const badge = screen.getByLabelText("3 pending");
    expect(badge.textContent).toBe("3");
    expect(screen.queryByLabelText("5 pending")).toBeNull();
    // The badge sits INSIDE the Alpha chip, not the Beta chip.
    expect(screen.getByText("Alpha").closest("button")).toBe(badge.closest("button"));
    expect(screen.getByText("Beta").closest("button")).not.toBe(badge.closest("button"));
  });

  it("renders no badges at all when `badges` is omitted", () => {
    render(<FamilyChips families={FAMILIES} value="a" onSelect={() => {}} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("also supports badges in filter mode", () => {
    render(<FamilyChips families={FAMILIES} selected="all" badges={{ b: 5 }} badgeLabels={labels} />);
    const badge = screen.getByLabelText("5 pending");
    expect(badge.textContent).toBe("5");
    expect(screen.getByText("Beta").closest("button")).toBe(badge.closest("button"));
  });

  it("falls back to the raw count as the accessible name when no matching label is given", () => {
    render(<FamilyChips families={FAMILIES} value="a" onSelect={() => {}} badges={{ a: 2 }} />);
    expect(screen.getByLabelText("2")).toBeTruthy();
  });
});
