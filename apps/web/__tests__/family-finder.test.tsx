// @vitest-environment jsdom
/**
 * Behavior test for the /families/find discovery surface (Tier 2): the client <FamilyFinder>
 * lists discoverable families by default (idle "Discoverable families" label), filters live on
 * name OR steward as you type, shows the mono match-count label, and the no-match line when a
 * non-empty query matches nothing. Also pins the leak-safe contract: only the family name +
 * steward name it was handed ever render — there is no path to member/story data here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FamilyFinder } from "@/app/families/find/FamilyFinder";
import type { DiscoverableFamily } from "@chronicle/core";

afterEach(cleanup);

const DISCOVERABLE: DiscoverableFamily[] = [
  { familyId: "f1", familyName: "The Boudreaux family", stewardName: "Eleanor Boudreaux" },
  { familyId: "f2", familyName: "The Thibodeaux family", stewardName: "Marco Thibodeaux" },
  { familyId: "f3", familyName: "The Reyes family", stewardName: "Ana Reyes" },
];

const noop = () => {};

function typeQuery(value: string) {
  const input = screen.getByPlaceholderText(/Try/i);
  fireEvent.change(input, { target: { value } });
}

describe("FamilyFinder", () => {
  it("lists all discoverable families by default with the idle label", () => {
    render(<FamilyFinder discoverable={DISCOVERABLE} action={noop} />);
    expect(screen.getByText("Discoverable families")).toBeTruthy();
    expect(screen.getByText("The Boudreaux family")).toBeTruthy();
    expect(screen.getByText("The Thibodeaux family")).toBeTruthy();
    expect(screen.getByText("The Reyes family")).toBeTruthy();
  });

  it("filters live by family name and shows the match-count label", () => {
    render(<FamilyFinder discoverable={DISCOVERABLE} action={noop} />);
    typeQuery("boudreaux");
    expect(screen.getByText("1 family matches")).toBeTruthy();
    expect(screen.getByText("The Boudreaux family")).toBeTruthy();
    expect(screen.queryByText("The Thibodeaux family")).toBeNull();
  });

  it("also matches on steward name", () => {
    render(<FamilyFinder discoverable={DISCOVERABLE} action={noop} />);
    typeQuery("marco");
    expect(screen.getByText("1 family matches")).toBeTruthy();
    expect(screen.getByText("The Thibodeaux family")).toBeTruthy();
  });

  it("shows the no-match line for a non-empty query that matches nothing", () => {
    render(<FamilyFinder discoverable={DISCOVERABLE} action={noop} />);
    typeQuery("zzzznope");
    expect(screen.getByText(/No discoverable family matches/i)).toBeTruthy();
    expect(screen.getByText("0 families match")).toBeTruthy();
  });

  it("renders each result's Request-to-join affordance", () => {
    render(<FamilyFinder discoverable={DISCOVERABLE} action={noop} />);
    expect(screen.getAllByRole("button", { name: /Request to join/i })).toHaveLength(3);
  });
});
