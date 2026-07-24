/**
 * Account › Memories — section-level copy (ADR-0029 §#357). Section-specific strings live HERE, never a
 * shared copy module.
 *
 * Day-1 this surface is backed by the Person's BIOGRAPHICAL ANCHORS (the only salient facts stored
 * today). The richer, story-derived narrator-memory ledger is a separately-tracked fast-follow (#362);
 * when it lands, only the data layer swaps — this copy stays anchor-honest until then.
 */
export const memoriesSectionCopy = {
  title: "What we remember",
  subtitle:
    "These are the facts the system holds about you. Review them, correct anything that's off, or clear what you'd rather it forget.",

  /** Honest provenance for the anchor-backed era: these come from your profile/intake, not a story. */
  provenanceLabel: "From your profile",
  provenanceNote:
    "You told us this when you set up your profile or during your first conversation — it isn't drawn from a story.",

  /** The forward-looking note that richer, story-derived memories are coming (they land with #362). */
  comingSoonNote:
    "Soon this list will also include things the interviewer picks up from the stories you tell — each shown with the story it came from. For now it holds the facts from your profile.",

  /** Empty state — no anchors set yet. */
  emptyTitle: "Nothing remembered yet",
  emptyBody:
    "As you fill in your profile and tell your stories, the facts the system holds about you will appear here for you to review.",

  /** Per-card controls. */
  editLabel: "Edit",
  clearLabel: "Forget this",
  saveLabel: "Save",
  cancelLabel: "Cancel",
  notSetLabel: "Not set",
  yesLabel: "Yes",
  noLabel: "No",

  /** Save-status hints. */
  saving: "Saving…",
  saved: "Saved",
  saveError: "Couldn't save — try again",
  cleared: "Forgotten",
} as const;

/**
 * The human labels for each anchor-backed memory. In the ledger era these become the memory's own
 * `title`; keeping them here means the mapping layer is the only thing that changes.
 */
export const memoryLabels = {
  hometown: "Where you're from",
  siblingContext: "Your brothers and sisters",
  currentLocation: "Where you live now",
  occupationSummary: "What you do (or did) for work",
  hasChildren: "Whether you have children",
  hasGrandchildren: "Whether you have grandchildren",
} as const;
