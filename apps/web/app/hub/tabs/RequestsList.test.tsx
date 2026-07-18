// @vitest-environment jsdom
/**
 * RequestsList (#159) — the presentational list of steward join-requests, extracted from the old
 * client "designator" when the Requests surface moved to the URL-driven family selector. It holds no
 * state and no chip bar: the rows arrive already fetched, authorized, and SCOPED by the server. Verifies
 * pending rows (name + family label + Approve/Decline), decided rows (mono status in place), and the
 * empty state.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RequestsList, type RequestRow } from "./RequestsList";
import { hub } from "@/app/_copy";

afterEach(() => cleanup());

const noop = async () => {};

function row(over: Partial<RequestRow> & { joinRequestId: string }): RequestRow {
  return {
    joinRequestId: over.joinRequestId,
    familyId: over.familyId ?? "fam-a",
    familyName: over.familyName ?? "Esposito",
    requesterName: over.requesterName ?? "Ann",
    message: over.message ?? null,
    status: over.status ?? "pending",
  };
}

describe("RequestsList", () => {
  it("renders a pending row with its name, family label, and Approve/Decline", () => {
    render(
      <RequestsList
        pending={[row({ joinRequestId: "r1", requesterName: "Ann", familyName: "Esposito" })]}
        decided={[]}
        approve={noop}
        decline={noop}
      />,
    );
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(screen.getByText("ESPOSITO")).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.requests.approve })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.requests.decline })).toBeTruthy();
  });

  it("renders a decided row with a mono status in place (no action buttons)", () => {
    render(
      <RequestsList
        pending={[]}
        decided={[row({ joinRequestId: "r2", requesterName: "Bea", status: "approved" })]}
        approve={noop}
        decline={noop}
      />,
    );
    expect(screen.getByText("Bea")).toBeTruthy();
    expect(screen.getByText(hub.requests.statusApproved.toUpperCase())).toBeTruthy();
    expect(screen.queryByRole("button", { name: hub.requests.approve })).toBeNull();
  });

  it("shows the empty state when there are no pending or decided rows", () => {
    render(<RequestsList pending={[]} decided={[]} approve={noop} decline={noop} />);
    expect(screen.getByText(hub.requests.empty)).toBeTruthy();
  });
});
