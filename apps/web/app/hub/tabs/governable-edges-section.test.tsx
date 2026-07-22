// @vitest-environment jsdom
/**
 * #254/#255 — List-view relationships section: actable edges only; steward nature picker on parent_of.
 *
 * Issue #265 — Phase-2 skin signatures: shared GovernableEdgeList module classes + CSS-source
 * guards for data-skin / reduce-motion / solemn (mirrors KinList #266; restrained — no tape/tilt).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import styles from "../kin/GovernableEdgeList.module.css";
import { GovernableEdgesSection } from "./GovernableEdgesSection";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../kin/GovernableEdgeList.module.css"), "utf8");

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
  correctEdgeAction: vi.fn(async () => undefined),
}));

import { correctEdgeAction } from "../kin/actions";

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
    assertedBy: over.assertedBy ?? over.personAId,
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
    viewerCanRemove: over.viewerCanRemove ?? over.viewerIsSteward ?? false,
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

it("#256: renders Remove for the original asserter (non-steward) and excludes a non-actable edge", () => {
  render(
    <GovernableEdgesSection
      familyId="F"
      edges={[
        edge({ personAId: "a", personBId: "b", viewerIsSteward: false, viewerCanRemove: true }),
        edge({ personAId: "c", personBId: "d", viewerIsSteward: false, viewerCanRemove: false }),
      ]}
    />,
  );
  expect(screen.getByTestId("family-gov-edges")).toBeTruthy();
  expect(screen.getAllByTestId("family-gov-edge")).toHaveLength(1);
  expect(screen.getByRole("button", { name: hub.kin.deny })).toBeTruthy();
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

it("shows nature picker on steward parent_of only and submits correctEdgeAction (#255)", async () => {
  render(
    <GovernableEdgesSection
      familyId="F"
      edges={[
        edge({
          personAId: "a",
          personBId: "b",
          edgeType: "parent_of",
          nature: "biological",
          viewerIsSteward: true,
        }),
        edge({
          personAId: "c",
          personBId: "d",
          personADisplayName: "Carol",
          personBDisplayName: "Dave",
          edgeType: "partnered_with",
          nature: null,
          viewerIsSteward: true,
        }),
      ]}
    />,
  );
  expect(screen.getByTestId("kin-edge-correct-nature")).toBeTruthy();
  expect(screen.getAllByTestId("kin-edge-correct-nature")).toHaveLength(1);
  const select = screen.getByLabelText(hub.kin.natureFieldLabel) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "step" } });
  fireEvent.click(screen.getByRole("button", { name: hub.kin.correct }));
  await waitFor(() => expect(correctEdgeAction).toHaveBeenCalled());
  const formData = (correctEdgeAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FormData;
  expect(formData.get("nature")).toBe("step");
  expect(formData.get("edgeType")).toBe("parent_of");
});

describe("GovernableEdgesSection — playful signature (#265)", () => {
  it("renders section / heading / intro / list / edge / sentence with module classes", () => {
    render(
      <GovernableEdgesSection
        familyId="F"
        edges={[edge({ personAId: "a", personBId: "b", viewerIsSteward: true })]}
      />,
    );
    const section = screen.getByTestId("family-gov-edges");
    expect(section.className).toContain(styles.section);
    expect(screen.getByText(hub.kin.govHeading).className).toContain(styles.heading);
    expect(screen.getByText(hub.kin.govIntro).className).toContain(styles.intro);
    const edgeItem = screen.getByTestId("family-gov-edge");
    expect(edgeItem.className).toContain(styles.edge);
    expect(edgeItem.closest("ul")!.className).toContain(styles.list);
    expect(screen.getByText(hub.kin.edgePartneredWith("Alice", "Bob")).className).toContain(
      styles.sentence,
    );
  });

  it("GovernableEdgeList.module.css declares the restrained playful signature block", () => {
    expect(css).toContain(':global(:root[data-skin="playful"])');
    expect(css).toContain("var(--shadow-lift)");
    // Dense stewardship guardrail: no full-scrapbook markers (tape / tilt / highlighter).
    expect(css).not.toContain("var(--tape-bg)");
    expect(css).not.toMatch(/--tilt/);
    expect(css).not.toContain("var(--highlighter)");
  });

  it("GovernableEdgeList.module.css declares the reduce-motion + solemn suppression block", () => {
    expect(css).toContain(':global(:root[data-reduce-motion="on"])');
    expect(css).toContain(':global(:root[data-skin="playful"] [data-tone="solemn"])');
    expect(css).toMatch(/transform:\s*none/);
  });
});
