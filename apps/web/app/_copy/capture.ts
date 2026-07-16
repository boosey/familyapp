// apps/web/app/_copy/capture.ts
// Copy for the s/[token] narrator capture + s/[token]/approve/[storyId] approval surfaces.
export const capture = {
  resting: {
    welcome: "Welcome.",
    body: "This link is resting for now. Whoever invited you will help you get started again.",
  },
  narrator: {
    conversationDate: (dateLabel: string) => `Conversation · ${dateLabel}`,
    hello: (spokenName: string) => `Hello, ${spokenName}.`,
    invite:
      "Whenever you're ready, tap the button and tell me anything you'd like. Take all the time you want.",
    eyebrowAsked: (askerSpokenName: string) => `${askerSpokenName} asked`,
    eyebrowDefault: "A thought to start with",
    starterPrompt:
      "What's something from your day, or from long ago, that's been on your mind?",
    thanks: "Thank you. Your family will love hearing this.",
    pickUpLater:
      "Let's pick this up another time. The person who invited you will check in soon.",
    // Slice 2b: shown while the out-of-band pipeline renders the story (poll until ready).
    preparing: "One moment — we're getting your story ready…",
    preparingSub: "Your recording is safe.",
    // Soft cap: processing ran past its window. Never spin forever — reassure and let go.
    takingLonger:
      "This is taking a little longer than usual. Your recording is safe — you can check back in a bit.",
  },
  approve: {
    welcome: "Welcome.",
    resting:
      "This link is resting for now. Whoever invited you will help you get started again.",
    thanks: "Thank you.",
    alreadySettled:
      "This one is already settled. You can close this window whenever you're ready.",
    brand: "Family Chronicle",
    yourStory: "Your Story",
    readyToShare: "Ready to share this one?",
    haveAListen: "Have a listen first. Then tell me who should be able to hear it.",
    confirmedThanks: "Thank you. Your family will hear it now.",
    pickUpLater:
      "Let's pick this up another time. The person who invited you will check in soon.",
    oneMoment: "One moment…",
    sayInOwnWords: 'Say it in your own words — "Yes, my family can hear this."',
    listening: "Listening…",
    imFinished: "I'm finished",
    whoShouldHear: "Who should hear this?",
    approveAloud: "Approve aloud",
    // Slice 2b: the narrator reached this page while the story is still rendering (draft). Show a
    // warm "check back" view that polls and reveals the approve UI the moment it's ready.
    preparingTitle: "Almost ready…",
    preparingBody: "We're getting your story ready to hear. This page will update on its own.",
    takingLonger:
      "This is taking a little longer than usual. Your recording is safe — you can come back to this page in a bit.",
    // Issue #11: the pipeline permanently failed (retries exhausted). Warm, non-technical, and
    // offers a one-tap retry — the recording itself is never at risk.
    failedTitle: "Something went wrong",
    failedBody:
      "We couldn't finish preparing your story this time. Your recording is safe — you can try again.",
    tryAgain: "Try again",
    retrying: "Trying again…",
  },
} as const;
