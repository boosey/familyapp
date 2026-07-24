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

  /** Honest provenance for the anchor-backed era: these come from your profile/intake, not a story.
   *  Folded into the title's InfoTooltip (change 3) — carries both the "what/why" (review/correct/
   *  forget) and the forward-looking note that story-derived memories are coming (#362), so nothing
   *  from the old subtitle/comingSoonNote paragraphs is lost, just consolidated into one tooltip. */
  provenanceLabel: "From your profile",
  provenanceNote:
    "These are facts you told us when you set up your profile or during your first conversation — not drawn from a story. Review them, correct anything that's off, or forget what you'd rather not keep. Soon this list will also include things the interviewer picks up from the stories you tell, each shown with the story it came from.",

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

  /** Add-a-memory affordance (#357 change 9) — a stub UI ahead of the narrator_memory ledger (#362). */
  addMemoryLabel: "Add a memory",
  addTitleLabel: "Title",
  addTitlePlaceholder: "e.g. My favorite recipe",
  addSummaryLabel: "Details",
  addSummaryPlaceholder: "Write what you'd like remembered…",
  addSave: "Save",
  addCancel: "Cancel",
  createNotAvailable: "Adding memories isn't available yet — check back soon.",
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
