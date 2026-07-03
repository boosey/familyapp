// apps/web/app/_copy/hub.ts
// Copy for the signed-in hub: shell, tabs, story browser, answer flow, server-action errors.

// Shared meta-label formatters — the Questions tab and the Answer screen render these identically.
const askedBy = (name: string) => `${name.toUpperCase()} ASKED`;
const recordedAt = (label: string) => `RECORDED ${label.toUpperCase()}`;

export const hub = {
  shell: {
    // Signed-out visitors are redirected to the root landing (the sign-in/sign-up front door),
    // so the hub shell itself has no anonymous copy.
    chronicle: "Your Chronicle",
    tabStories: "Stories",
    // Tab label follows the "Story Browse (Hub)" design ("To answer"); the section heading inside
    // the tab stays "Questions for you" (hub.questions.title).
    tabQuestions: "To answer",
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
    // Self-initiated telling (ADR-0007): the Stories-tab entry into /hub/tell, plus the resume list
    // for ask-less drafts still in review.
    tellTitle: "Tell a story",
    tellBlurb: "Something you want to remember — start it whenever it comes to you.",
    resumeHeading: "Finish what you started",
    resume: "Finish",
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
    voiceLabel: "Tap to answer",
    voiceStop: "Tap when you're done",
    transcribing: "Transcribing…",
    micError: "We couldn't reach your microphone. You can type your answer instead.",
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
    intro:
      "As steward, you approve everyone who joins. Nothing is shared with a requester until you say yes.",
    empty: "No requests waiting right now.",
    approve: "Approve",
    decline: "Decline",
    // Mono status shown in place once a request is decided (uppercased in the view).
    statusApproved: "Approved",
    statusDeclined: "Declined",
  },
  // "Story Browse (Hub)" surface — Feed / Timeline / Search modes + family-scope filter + the
  // restyled Read view.
  browse: {
    // Mode segmented control
    modeFeed: "Feed",
    modeTimeline: "Timeline",
    modeSearch: "Search",
    // Family-scope filter
    scopeAll: "All families",
    // Feed empty state (scope-aware). scopeName: "your families" or "the {family} family".
    scopeNameAll: "your families",
    scopeNameFamily: (family: string) => `the ${family} family`,
    feedEmpty: (scopeName: string) => `Nothing shared with you yet in ${scopeName}.`,
    feedEmptySub:
      "Once someone in the family answers a question or tells a story, it will appear here for you to listen to or read.",
    // Timeline
    timelineHeadingWhole: "The whole family, by era",
    timelineHeadingNarrator: (name: string) => `${name}’s life, by era`,
    widenWhole: "Whole family",
    widenNarrator: (name: string) => `Just ${name}`,
    undated: "Undated",
    // Chronicle Search
    searchPlaceholder: "Search titles, places, moments…",
    searchIdle:
      "Search across everything shared with you — titles, summaries, places, and tags.",
    searchCount: (n: number) => `${n} ${n === 1 ? "story matches" : "stories match"}`,
    searchNoResults: (query: string) => `No stories match “${query}”`,
    searchNoResultsHint:
      "Try a name, a place, or a moment like “wedding” or “the storm”.",
    // Read + Listen view
    back: "Back",
    toldBy: (name: string) => `Told by ${name}`,
    readListenTitle: (name: string) => `${name}’s voice — the original recording`,
    readStory: "Story",
    readTranscript: "Transcript",
    readNoProse: "No prose yet — the original recording above is the whole story for now.",
    readNoTranscript: "No transcript yet.",
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
    // Follow-up thread (Task 7): the interviewer proposes a deepening question; declining is a
    // first-class, peer-level path — never a dead end.
    followUpIntro: "One more, if you'd like:",
    thatsAllForNow: "That's all for now",
    // Shown on the follow-up screen while finishThreadAction stitches + polishes (a multi-second
    // inline render) so the decline tap visibly registers — declining is never a dead end.
    finishing: "One moment…",
    followUpTakeLabel: "Follow-up",
    dropTake: "Remove this part",
    initialAnswerLabel: "Your answer",
  },
  // Generalized story composer (ADR-0007): the capture voice⇄text toggle + the review title field.
  // Shared by the answer flow (an ask) and the self-initiated telling (/hub/tell, no ask).
  compose: {
    backToStories: "← Back to stories",
    titleLabel: "Title",
    typeIt: "Type it",
    textareaLabel: "Your story",
    speak: "Speak",
    tellPrompt: "What do you want to remember?",
    textPlaceholder: "Write it however it comes to you.",
    continueLabel: "Continue",
    inputModeAria: "How would you like to tell this?",
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
    noFamily: "Join or start a family before adding photos.",
    photoEmpty: "No photo was selected. Please choose an image.",
    photoUploadFailed: "Could not add your photo. Please try again.",
  },
  album: {
    title: "Family album",
    empty: "No photos yet. Add the first one below.",
    addLabel: "Add a photo",
    addButton: "Add to album",
    photoAlt: (caption: string | null) => caption ?? "Family photo",
  },
  storyDetail: {
    // The "‹" chevron is a sized decorative glyph kept in JSX; this is just the word.
    back: "Stories",
    byline: (narrator: string, recordedAt: string) =>
      `Told by ${narrator} · Recorded ${recordedAt}`,
    noProse: "No prose yet — the original recording above is the whole story for now.",
  },
} as const;

