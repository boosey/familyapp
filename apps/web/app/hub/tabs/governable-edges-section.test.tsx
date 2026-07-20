// @vitest-environment jsdom
/**
 * #254 — List-view relationships section: actable edges only; no mount when the viewer can act on none.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { GovernableEdgesSection } from "./GovernableEdgesSection";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../kin/actions", () => ({
  affirmEdgeAction: vi.fn(async () => undefined),
  denyEdgeAction: vi.fn(async () => undefined),
  hideEdgeAction: vi.fn(async () => undefined),
}));

function edge(over: Partial<GovernableKinEdge> & Pick<GovernableKinEdge, "personAId" | "personBId">): GovernableKinEdge {
  return {
    edgeType: over.edgeType ?? "partnered_with",
    personAId: over.personAId,
    personBId: over.personBId,
    personADisplayName: over.personADisplayName ?? "Alice",
    personAIdentified: over.personAIdentified ?? true,
    personBDisplayName: over.personBDisplayName ?? "Bob",
    personBIdentified: over.personBIdentified ?? true,
    nature: over.nature ?? null,
    state: over.state ?? "asserted",
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
  };
}

it("renders Remove for steward edges and Hide for endpoint edges", () => {
  render(
    <GovernableEdgesSection
      familyId="F"
      edges={[
        edge({ personAId: "a", personBId: "b", viewerIsSteward: true }),
        edge({
          personAId: "c",
          personBId: "d",
          personADisplayName: "Carol",
          personBDisplayName: "Dave",
          viewerCanHide: true,
        }),
      ]}
    />,
  );
  expect(screen.getByTestId("family-gov-edges")).toBeTruthy();
  expect(screen.getByText(hub.kin.govHeading)).toBeTruthy();
  expect(screen.getAllByTestId("family-gov-edge")).toHaveLength(2);
  expect(screen.getByRole("button", { name: hub.kin.deny })).toBeTruthy();
  expect(screen.getByRole("button", { name: hub.kin.hide })).toBeTruthy();
});

it("renders nothing when no edges are actable", () => {
  render(
    <GovernableEdgesSection
      familyId="F"
      edges={[edge({ personAId: "a", personBId: "b" })]}
    />,
  );
  expect(screen.queryByTestId("family-gov-edges")).toBeNull();
});
