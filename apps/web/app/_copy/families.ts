// apps/web/app/_copy/families.ts
// Copy for the families/find, families/new, and families/start routes.
export const families = {
  find: {
    statusWaiting: "Waiting for the steward",
    statusApproved: "Approved — welcome in",
    statusNotAccepted: "Not accepted",
    title: "Find your family",
    intro:
      "Search by family name, steward, or a member's name. Only discoverable families show up — this never joins you, it sends a request the steward approves.",
    requestFailed:
      "We couldn't send that request — you may already be a member, or already have a request waiting for that family.",
    searchPlaceholder: "Try “Boudreaux”, “Eleanor”, or “bakers”",
    // Idle (empty query) vs filtered labels for the discoverable-family browse list.
    browseLabel: "Discoverable families",
    matchCount: (n: number) => (n === 1 ? "1 family matches" : `${n} families match`),
    noMatches: (query: string) =>
      `No discoverable family matches “${query}”. Try a different name, place, or description.`,
    stewardMeta: (steward: string) => `Steward: ${steward}`,
    notePlaceholder: "Add a note for the steward (optional) — e.g. “I'm Rosa's cousin.”",
    requestToJoin: "Request to join",
    yourRequests: "Your requests",
    // Dedicated "request sent" confirmation screen.
    sentTitle: (steward: string) => `Your request is with ${steward}.`,
    sentBody: (stewardFirst: string, family: string) =>
      `We'll let you know as soon as ${stewardFirst} approves — you'll land right in the ${family} hub.`,
    sentBack: "Back to search",
  },
  new: {
    title: "Name your family",
    intro:
      "This is how it'll appear to everyone you invite. You can change it later — you're its steward, so you approve who joins.",
    errorNoName: "Please give your family a name.",
    nameLabel: "Family name",
    namePlaceholder: "The Boudreaux family",
    descLabel: "Description",
    descLabelOptional: "(optional)",
    descPlaceholder: "The Boudreaux family of Lafayette, Louisiana.",
    discoverableLabel: "Let other relatives find this family",
    discoverableHint: "They can search for it and ask to join. You approve every request.",
    submit: "Create family",
  },
  start: {
    title: "You're signed in. Whose family is this?",
    intro: "Start a new one, or find a family you already belong to.",
    freshIcon: "🏛",
    freshTitle: "Start a new family",
    freshBody: "You'll be its steward — the first to invite others in.",
    joinIcon: "🔎",
    joinTitle: "Find my family",
    joinBody: "Search for a family that's already gathering stories.",
  },
} as const;
