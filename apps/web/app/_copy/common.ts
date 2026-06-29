// apps/web/app/_copy/common.ts
// Shared, cross-route display copy. Static strings are literals; dynamic
// strings are arrow functions whose params become i18n placeholders later.
export const common = {
  appName: "Family Chronicle",

  account: {
    yourAccount: "Your account",
    accountMenu: "Account menu",
  },

  fontScale: {
    labels: ["Smallest text", "Small text", "Medium text", "Large text", "Largest text"],
    control: "Text size",
  },

  listenBar: {
    seek: "Seek",
    startOver: "Start over",
    back10: "Back 10 seconds",
    forward10: "Forward 10 seconds",
    nextStory: "Next story",
    play: "Play",
    pause: "Pause",
  },

  voiceButton: {
    oneMoment: "One moment…",
    listening: "Listening…",
    tapToSpeak: "Tap to speak",
  },

  storyCard: {
    photo: "photo",
    pinned: "Pinned",
    badgeNew: "New",
    recordedTitle: (label: string) => `Recorded ${label}`,
  },

  authScreenBrand: "Family Chronicle",

  // Shared audience tiers (used by AnswerFlow + ApprovalRecorder)
  audienceTiers: {
    family: { label: "My whole family", desc: "Everyone in the family" },
    branch: { label: "Just one branch", desc: "A chosen part of the family" },
    public: { label: "Anyone", desc: "Shared openly" },
  },

  relativeTime: {
    justNow: "just now",
    minsAgo: (n: number) => `${n} min ago`,
    hrsAgo: (n: number) => `${n}h ago`,
  },

  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
} as const;
