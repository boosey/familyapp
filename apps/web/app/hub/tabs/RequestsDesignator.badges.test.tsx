// @vitest-environment jsdom
/**
 * #140 — when the Requests surface is active, each family selector chip shows that family's pending
 * join-request count, grouped from the steward's FULL pending set (independent of which chip is
 * currently designated), and the per-chip counts sum to the aggregate (total pending) shown on the
 * Family/Requests badge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RequestsDesignator, type RequestRow } from "./RequestsDesignator";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(cleanup);

const FAMILIES = [
  { id: "fam-a", name: "Alpha" },
  { id: "fam-b", name: "Beta" },
];

function pendingRow(id: string, familyId: string, familyName: string): RequestRow {
  return {
    joinRequestId: id,
    familyId,
    familyName,
    requesterName: `Requester ${id}`,
    message: null,
    status: "pending",
  };
}

const noop = async () => {};

describe("RequestsDesignator per-family badges (#140)", () => {
  it("badges each chip with its own pending count; the counts sum to the total", () => {
    // 2 pending for Alpha, 1 pending for Beta → aggregate 3.
    const pending = [
      pendingRow("r1", "fam-a", "Alpha"),
      pendingRow("r2", "fam-a", "Alpha"),
      pendingRow("r3", "fam-b", "Beta"),
    ];
    render(
      <RequestsDesignator
        families={FAMILIES}
        seedFamilyId="fam-a"
        pending={pending}
        decided={[]}
        approve={noop}
        decline={noop}
      />,
    );

    // Alpha chip → 2 pending; Beta chip → 1 pending (accessible names from hub.requests.pendingCountAria).
    const alphaBadge = screen.getByLabelText("2 pending");
    const betaBadge = screen.getByLabelText("1 pending");
    expect(alphaBadge.textContent).toBe("2");
    expect(betaBadge.textContent).toBe("1");

    // Sum of per-chip counts equals the total pending (the aggregate badge value upstream).
    const sum = Number(alphaBadge.textContent) + Number(betaBadge.textContent);
    expect(sum).toBe(pending.length);
  });

  it("shows no badge for a family with zero pending requests", () => {
    const pending = [pendingRow("r1", "fam-a", "Alpha")];
    render(
      <RequestsDesignator
        families={FAMILIES}
        seedFamilyId="fam-a"
        pending={pending}
        decided={[]}
        approve={noop}
        decline={noop}
      />,
    );
    expect(screen.getByLabelText("1 pending")).toBeTruthy();
    // Beta has none — no "0 pending" badge is rendered.
    expect(screen.queryByLabelText("0 pending")).toBeNull();
  });
});
