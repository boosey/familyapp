// @vitest-environment jsdom
/**
 * KinList — the Family tab's List view (2026-07-14). A read-only, searchable list of the viewer's
 * relatives (the old /hub/kin list, folded into the tab). The search box filters by name OR relation;
 * empty list and no-match states each show their own note; a deceased relative is marked "In memory".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinListEntry } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KinList } from "@/app/hub/tabs/KinList";

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
