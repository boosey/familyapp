/**
 * #372 — the pure status-badge rule for a person-card in the VIEWED family. One vocabulary shared by
 * three surfaces (tree card, details sheet, Family List): given a person's family-scoped standing,
 * decide which badge (if any) to show. No React, no "use client" — a plain function so the projection
 * and every surface derive the SAME badge from one source of truth.
 */
import type { TreeNode } from "@chronicle/core";

export type PersonCardBadge = "eligible" | "invited" | "steward";

/** Structural input — a `TreeNode` and a hydrated `FamilyListPerson` both satisfy it. */
export interface PersonBadgeInput {
  identified: boolean;
  lifeStatus: "living" | "deceased";
  membership: "member" | "tree-only";
  isSteward: boolean;
  inviteStatus: TreeNode["inviteStatus"];
  relationToRoot: TreeNode["relationToRoot"];
}

/**
 * Precedence steward → invited → eligible. A bridge (unidentified), the focus-root/self, an existing
 * member, or a deceased person get NO badge.
 */
export function personCardBadgeFor(node: PersonBadgeInput): PersonCardBadge | null {
  if (!node.identified) return null; // anonymous bridge
  if (node.relationToRoot === "self") return null; // focus-root / self
  if (node.isSteward) return "steward";
  if (node.inviteStatus === "pending") return "invited";
  if (node.membership === "tree-only" && node.lifeStatus === "living") return "eligible";
  return null; // member / deceased / etc.
}
