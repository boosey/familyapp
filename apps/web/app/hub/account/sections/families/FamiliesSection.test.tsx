// @vitest-environment jsdom
/**
 * Account › Families (ADR-0029, design-out change #10) — the merged single-list: a row shows the
 * viewer's role, and ADDITIONALLY a "Family settings" icon-link when the viewer stewards that family.
 * FamiliesSection is an async server component; we await it directly and render the resolved element
 * (the shell's `[section]/page.tsx` does the same).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FamiliesSection from "./index";

vi.mock("@chronicle/core", () => ({
  listActiveFamiliesForPerson: vi.fn(async () => [
    { familyId: "fam-1", familyName: "The Boudreauxs", familyShortName: null },
    { familyId: "fam-2", familyName: "The Espositos", familyShortName: null },
  ]),
  listActiveMembershipsForPerson: vi.fn(async () => [
    { familyId: "fam-1", role: "steward" },
    { familyId: "fam-2", role: "member" },
  ]),
  listFamiliesStewardedBy: vi.fn(async () => [
    { familyId: "fam-1", name: "The Boudreauxs", shortName: null },
  ]),
}));

afterEach(() => cleanup());

describe("FamiliesSection — single list with steward icon", () => {
  it("shows one row per active family with its role, and a settings icon-link only for stewarded ones", async () => {
    const element = await FamiliesSection({
      personId: "person-1",
      db: {} as never,
      viewer: { kind: "account", personId: "person-1" },
    });
    render(element);

    // Exactly one list, not a duplicated members/steward split.
    expect(screen.getAllByRole("list").length).toBe(1);

    expect(screen.getByText("The Boudreauxs")).toBeTruthy();
    expect(screen.getByText("Steward")).toBeTruthy();
    expect(screen.getByText("The Espositos")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();

    // Stewarded family (fam-1) gets the settings icon-link.
    const settingsLink = screen.getByRole("link", { name: "Family settings" });
    expect(settingsLink.getAttribute("href")).toBe("/families/fam-1/edit");

    // Only one such link exists — the non-stewarded family has no icon-link.
    expect(screen.getAllByRole("link", { name: "Family settings" }).length).toBe(1);
  });
});
