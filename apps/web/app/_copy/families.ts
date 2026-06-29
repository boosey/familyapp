// apps/web/app/_copy/families.ts
// Copy for the families/find, families/new, and families/start routes.
export const families = {
  find: {
    statusWaiting: "Waiting for the steward",
    statusApproved: "Approved — welcome in",
    statusNotAccepted: "Not accepted",
    title: "Find your family",
    intro:
      "Search for a family a relative already created, then ask to join. The steward approves every request.",
    requestSent:
      "Your request is on its way — it's waiting for the family's steward to say yes.",
    requestFailed:
      "We couldn't send that request — you may already be a member, or already have a request waiting for that family.",
    searchPlaceholder: "Search by family name, a relative's name, or describe them…",
    search: "Search",
    noMatches: (query: string) => `No families matched “${query}”. Try a relative's name, or ask them for an invite link instead.`,
    resultMeta: (steward: string, reason: string) =>
      `STEWARD · ${steward.toUpperCase()} · MATCH: ${reason.toUpperCase()}`,
    notePlaceholder: "Add a note for the steward (optional) — e.g. “I’m Rosa’s cousin.”",
    requestToJoin: "Request to join",
    yourRequests: "Your requests",
  },
  new: {
    title: "Name your family",
    intro: "This is the space your stories live in. You can change the details later.",
    errorNoName: "Please give your family a name.",
    nameLabel: "Family name",
    namePlaceholder: "Boudreaux",
    descLabel: "Description",
    descLabelOptional: "(optional)",
    descPlaceholder: "The Boudreaux family of Lafayette, Louisiana.",
    discoverableLabel: "Let other relatives find this family",
    discoverableHint: "They can search for it and ask to join. You approve every request.",
    submit: "Create family",
  },
  start: {
    title: "Let's find your family",
    intro: "Start a brand-new family space, or join one a relative has already created.",
    freshEyebrow: "Start fresh",
    freshTitle: "Start a new family",
    freshBody:
      "Name your family and become its steward. You'll invite relatives and narrators next.",
    joinEyebrow: "Join existing",
    joinTitle: "Find your family",
    joinBody: "Search for a family a relative already set up, and ask to join it.",
  },
} as const;
