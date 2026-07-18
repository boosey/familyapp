import { describe, expect, it } from "vitest";
import { familyTabBadge, requestsTabVisible } from "./hub-tabs";

describe("familyTabBadge", () => {
  // Regression (#124): the Family-tab badge shows the actionable pending-request count and hides at
  // zero, so a decided-only queue never badges the tab.
  it("hides (undefined) at zero pending", () => {
    expect(familyTabBadge(0)).toBeUndefined();
  });

  it("returns the pending count when > 0", () => {
    expect(familyTabBadge(1)).toBe(1);
    expect(familyTabBadge(5)).toBe(5);
  });
});

describe("requestsTabVisible (Family sub-nav gate)", () => {
  it("is visible for a member with a decided-only queue (no pending)", () => {
    expect(requestsTabVisible(1, 0, 2)).toBe(true);
  });

  it("is hidden when everything is zero", () => {
    expect(requestsTabVisible(1, 0, 0)).toBe(false);
  });
});
