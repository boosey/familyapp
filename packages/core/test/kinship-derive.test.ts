/**
 * Pure deriveKin tests for sibling / half_sibling / step_sibling (#284).
 * Edges are constructed in-memory — no DB — so graphs stay explicit and fast.
 */
import { describe, expect, it } from "vitest";
import {
  deriveKin,
  RELATION_PRECEDENCE,
  type KinRelation,
  type ResolvedKinshipEdge,
} from "../src/kinship-derive";

const t0 = new Date(0);

function parentOf(
  parentId: string,
  childId: string,
  nature: NonNullable<ResolvedKinshipEdge["nature"]> = "biological",
): ResolvedKinshipEdge {
  return {
    edgeType: "parent_of",
    personAId: parentId,
    personBId: childId,
    nature,
    state: "asserted",
    assertedBy: "actor",
    assertedAt: t0,
    updatedAt: t0,
  };
}

function partnered(a: string, b: string): ResolvedKinshipEdge {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return {
    edgeType: "partnered_with",
    personAId: lo,
    personBId: hi,
    nature: null,
    state: "asserted",
    assertedBy: "actor",
    assertedAt: t0,
    updatedAt: t0,
  };
}

function relationOf(edges: ResolvedKinshipEdge[], root: string, target: string): KinRelation | undefined {
  return deriveKin(edges, root).find((k) => k.personId === target)?.relation;
}

describe("deriveKin — full / half / step siblings (#284)", () => {
  it("labels full siblings when two people share two parents", () => {
    const edges = [
      parentOf("mom", "alice"),
      parentOf("dad", "alice"),
      parentOf("mom", "bob"),
      parentOf("dad", "bob"),
      partnered("mom", "dad"),
    ];
    expect(relationOf(edges, "alice", "bob")).toBe("sibling");
    expect(relationOf(edges, "bob", "alice")).toBe("sibling");
  });

  it("labels half-siblings when two people share exactly one parent", () => {
    const edges = [
      parentOf("mom", "alice"),
      parentOf("dad", "alice"),
      parentOf("mom", "cara"), // this parent only
      partnered("mom", "dad"),
    ];
    expect(relationOf(edges, "alice", "cara")).toBe("half_sibling");
    expect(relationOf(edges, "cara", "alice")).toBe("half_sibling");
  });

  it("labels step-siblings via partner-bridge with no shared parent-of", () => {
    // Mom partnered with Stepdad; Alice is Mom's child; Derek is Stepdad's child only.
    const edges = [
      parentOf("mom", "alice"),
      parentOf("stepdad", "derek"),
      partnered("mom", "stepdad"),
    ];
    expect(relationOf(edges, "alice", "derek")).toBe("step_sibling");
    expect(relationOf(edges, "derek", "alice")).toBe("step_sibling");
  });

  it("multi-partner partner-bridge: child of one partner is step to child of another", () => {
    // Mom partnered with Dad AND Stepdad (multi-partner). Alice = Mom+Dad; Eli = Stepdad only.
    const edges = [
      parentOf("mom", "alice"),
      parentOf("dad", "alice"),
      partnered("mom", "dad"),
      partnered("mom", "stepdad"),
      parentOf("stepdad", "eli"),
    ];
    expect(relationOf(edges, "alice", "eli")).toBe("step_sibling");
    expect(relationOf(edges, "eli", "alice")).toBe("step_sibling");
  });

  it("shared parent-of with nature=step is half/full by parent count, never step_sibling", () => {
    // Stepdad is a step parent_of of both kids — they share Mom + Stepdad → full sibling.
    const edges = [
      parentOf("mom", "alice"),
      parentOf("stepdad", "alice", "step"),
      parentOf("mom", "bob"),
      parentOf("stepdad", "bob", "step"),
      partnered("mom", "stepdad"),
    ];
    expect(relationOf(edges, "alice", "bob")).toBe("sibling");
    expect(relationOf(edges, "alice", "bob")).not.toBe("step_sibling");
  });

  it("shared parent-of beats partner-bridge: one shared parent → half_sibling, not step", () => {
    // Mom parent of both; Stepdad partnered with Mom and parent of Derek only → Alice↔Derek half.
    const edges = [
      parentOf("mom", "alice"),
      parentOf("mom", "derek"),
      parentOf("stepdad", "derek"),
      partnered("mom", "stepdad"),
    ];
    expect(relationOf(edges, "alice", "derek")).toBe("half_sibling");
  });

  it("ranks sibling closer than half_sibling closer than step_sibling in RELATION_PRECEDENCE", () => {
    const sib = RELATION_PRECEDENCE.indexOf("sibling");
    const half = RELATION_PRECEDENCE.indexOf("half_sibling");
    const step = RELATION_PRECEDENCE.indexOf("step_sibling");
    expect(sib).toBeGreaterThanOrEqual(0);
    expect(half).toBeGreaterThan(sib);
    expect(step).toBeGreaterThan(half);
  });
});
