// apps/web/app/_copy/hub.ts
// Copy for the signed-in hub: shell, tabs, story browser, answer flow, server-action errors.

// Shared meta-label formatters — the Questions tab and the Answer screen render these identically.
const askedBy = (name: string) => `${name.toUpperCase()} ASKED`;
const recordedAt = (label: string) => `RECORDED ${label.toUpperCase()}`;

export const hub = {
  shell: {
    // Brand name lives in common.appName — referenced directly by hub/page.tsx.
    signedOut: "Sign in to see your family's stories.",
    signIn: "Sign in",
    createFamily: "Create your family",
    chronicle: "Your Chronicle",
    tabStories: "Stories",
    tabQuestions: "Questions for you",
    tabAsk: "Ask a question",
    tabAsks: "Your asks",
    tabInvite: "Invite",
    tabRequests: "Requests",
    menuProfile: "Your profile",
    menuSettings: "Settings",
    menuManageFamily: "Manage family",
    menuSwitchUser: "Switch user",
    menuLogOut: "Log out",
    sectionsAria: "Hub sections",
    unreadAria: (badge: number) => `${badge} unread`,
  },
  stories: {
    untitled: "Untitled",
    empty:
      "No stories yet. When someone shares a chronicle with you, their stories will appear here.",
  },
  intake: {
    // Banner shown at the top of the hub until the narrator's biographical profile is complete.
    // Its CTA links to /hub/about-you (the intake surface).
    aria: "Your introduction",
    body: "There's still a little more of your introduction to fill in — a few details about where you're from and the life you've lived.",
    cta: "Continue your introduction",
  },
  aboutYou: {
    // The /hub/about-you intake surface — a short structured walk through the biographical profile.
    eyebrow: "Your introduction",
    progress: "A few quick questions",
    typeInstead: "Type instead",
    voiceUnavailable: "Voice isn't available here yet — type your answer below.",
    voiceLabel: "Tap to answer",
    next: "Next",
    saving: "Saving…",
    takeMeToHub: "Take me to the hub →",
    saveError: "We couldn't save that one. You can keep going.",
    doneEyebrow: "Thank you",
    doneTitle: "That's a lovely start.",
    doneBody: "Your family now has a little more to ask you about. There's always more to tell whenever you're ready.",
  },
  questions: {
    title: "Questions for you",
    intro: "Your family asked these. Answer whenever you're ready — there's no rush.",
    caughtUp: "You're all caught up. Nothing waiting.",
    askedBy,
    recordedAt,
    reviewApprove: "Review & approve",
    answer: "Answer",
  },
  ask: {
    signedOut: "Sign in to ask a question.",
    heading: "Ask a question",
    intro:
      "Your question goes into the queue. It will be asked next time they sit down to talk — never as an interruption.",
    promptEyebrow: "What would you love to hear?",
    promptQuestion: "A good ask is small and human — a name, a smell, a feeling, a Sunday.",
    forLabel: "For",
    questionLabel: "Your question",
    questionPlaceholder: "e.g. What was your mother singing on Sunday mornings?",
    submit: "Send to the queue",
  },
  asks: {
    signedOut: "Sign in to see your asks.",
    title: "Your asks",
    intro: "The questions you’ve sent, and where they are.",
    empty: "You haven’t asked anything yet.",
    forTarget: (name: string) => `For ${name}:`,
    listen: "Listen",
    answeredPrivate: "ANSWERED · PRIVATE",
    inQueue: "IN THE QUEUE",
  },
  invite: {
    personalLinkOnce: "Personal link — shown once",
    narratorReadyTitle: "Link is ready",
    narratorReadyBlurb:
      "Send this to your narrator however you usually talk — text or email. Tapping it opens their recording page directly. There is no password.",
    fingerprintNote:
      "For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it.",
    memberReadyTitle: "Invitation link is ready",
    memberReadyBlurb:
      "Send this to your relative. Opening it lets them create a login and join your family — you don't have to set anything up for them.",
    signedOut: "Sign in to invite someone.",
    memberHeading: "Invite a family member",
    memberBody:
      "Send a relative a link to create their own login and join the family. They'll confirm who they are, then go through a short welcome.",
    nameLabel: "Their name",
    namePlaceholder: "e.g. Rosa Esposito",
    // "Their email" and "(optional)" are split so the span styling is preserved in JSX.
    emailLabel: "Their email",
    emailLabelOptional: "(optional)",
    emailPlaceholder: "rosa@example.com",
    // "Relationship" and "(optional)" are split so the span styling is preserved in JSX.
    relationshipLabel: "Relationship",
    relationshipLabelOptional: "(optional)",
    relationshipPlaceholder: "e.g. your cousin",
    familyLabel: "Family",
    createInviteLink: "Create invite link",
    narratorHeading: "Invite a narrator to record",
    narratorBody:
      "Creates a personal link that opens the narrator's recording page. No login, no account — the link is the identity.",
    narratorLabel: "Narrator",
    createLink: "Create link",
  },
  requests: {
    signedOut: "Sign in to review join requests.",
    title: "Requests to join",
    intro: "People asking to join a family you steward. Approving adds them as a member.",
    empty: "No requests waiting right now.",
    approve: "Approve",
    decline: "Decline",
  },
  browser: {
    ofTotal: (shown: number, total: number) => `${shown} OF ${total}`,
    totalStories: (total: number) => `${total} ${total === 1 ? "STORY" : "STORIES"}`,
    matchCount: (n: number) => `${n} ${n === 1 ? "story matches" : "stories match"}`,
    findStories: "Find stories",
    storyCount: (n: number) => `${n} ${n === 1 ? "story" : "stories"}`,
    searchPlaceholder: "Try a name, a place, or a moment…",
    noMatchHint: "Hmm — nothing matched. Try a name, a year, or a word from the story.",
    showMe: "Show me",
    everyones: "everyone’s",
    someone: "someone",
    possessive: (person: string) => `${person}’s`,
    storiesAbout: "stories about",
    anything: "anything",
    fromConnector: ", from",
    anyTimeLower: "any time",
    theEra: (era: string) => `the ${era}`,
    period: ".",
    whoseStories: "Whose stories?",
    aboutWhat: "About what?",
    fromWhen: "From when?",
    everyone: "Everyone",
    anyEra: "Any era",
    anythingOption: "Anything",
    clear: "Clear",
    startOver: "Start over",
    done: "Done",
    noMatchWiden: "No stories match. Try widening your search.",
    earlierMemories: "Earlier memories",
    originalRecording: "The original recording",
    readProse: "Read the prose ›",
    openStory: "Open this story ›",
    anyTime: "Any time",
  },
  copyButton: {
    copied: "Copied ✓",
    copy: "Copy",
  },
  answer: {
    backToQuestions: "← Back to questions",
    askedBy,
    assembling: "Putting your story together…",
    assemblingSub: "This takes just a moment.",
    recordedAt,
    whoShouldHear: "Who should hear this?",
    reviewYourWords: "Read it over — edit anything that isn't quite right",
    genericError: "Something went wrong. Please try again.",
    shareWithFamily: "Share with family",
    reRecord: "Re-record",
    discard: "Discard",
    micError:
      "Something went wrong with the microphone. Make sure you've allowed microphone access, then refresh the page to try again.",
    listeningTapStop: "Listening… tap to stop",
    // "One moment…" / "Tap to speak" live in common.voiceButton (shared with other capture surfaces).
    takeYourTime: "Take your time. Long silences are fine.",
    // Optimistic review: shown over the editor slot while transcribe+render runs.
    polishing: "Polishing your words…",
    polishingSub: "Your recording is saved — this just takes a moment.",
    recordAgain: "Record again",
    // Soft cap: the processing poll ran past its window without the story becoming ready. The
    // recording is safe (it's slow or stuck out-of-band); never spin forever — say so warmly.
    takingLonger:
      "This is taking longer than usual. Your recording is safe — check back in a little while.",
  },
  actions: {
    notSignedIn: "Not signed in.",
    invalidInput: "Invalid input.",
    notForYou: "This question is not for you.",
    alreadyAnswered: "That question has already been answered.",
    recordingEmpty: "Recording was empty. Please try again.",
    saveFailed: "Could not save your recording. Please try again.",
    pickAudience: "Please pick an audience before sharing.",
    storyNotFound: "Story not found.",
    shareFailed: "Something went wrong sharing your story. Please try again.",
    removeFailed: "Could not remove the recording. Please try again.",
  },
  storyDetail: {
    // The "‹" chevron is a sized decorative glyph kept in JSX; this is just the word.
    back: "Stories",
    byline: (narrator: string, recordedAt: string) =>
      `Told by ${narrator} · Recorded ${recordedAt}`,
    noProse: "No prose yet — the original recording above is the whole story for now.",
  },
} as const;

