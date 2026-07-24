/**
 * Account › Families — section-level copy (ADR-0029). The PERSONAL membership slice consolidated from
 * the avatar menu: the families the viewer belongs to (with their role), steward "Family settings"
 * links-out, and Create / Find. Section-specific strings live HERE, never a shared copy module.
 *
 * Deliberately omitted: per-viewer short-name override and leave/pause. CONTEXT.md § Short name marks
 * the per-viewer override a *future* account-level preference with no backend yet, and there is no
 * self-leave/pause write path (`endMembership` is steward-only member removal, not a self-action), so
 * this section surfaces only what has a real backend rather than stubbing dead affordances.
 */
export const familiesSectionCopy = {
  title: "Your families",
  /** Empty-state when the viewer holds no active membership in any family. */
  empty: "You don't belong to any families yet.",
  /** Per-membership role labels (the viewer's DB role in each family). */
  roleLabel: {
    steward: "Steward",
    narrator: "Narrator",
    member: "Member",
  },
  /** Icon-link aria-label/title for the steward-only settings shortcut, now shown inline per row. */
  familySettingsLink: "Family settings",
  /** Create / Find actions. */
  actionsHeading: "Join or start a family",
  createFamily: "Create a family",
  findFamily: "Find a family",
} as const;
