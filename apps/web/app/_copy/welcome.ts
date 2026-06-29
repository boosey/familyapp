// apps/web/app/_copy/welcome.ts
// Copy for the welcome onboarding flow.
export const welcome = {
  introEyebrowInvited: "You're invited in",
  introEyebrowDefault: "Welcome",
  greetingNamed: (firstName: string) => `Welcome to the family, ${firstName}.`,
  greetingDefault: "Welcome to Family Chronicle.",
  introBody:
    "A couple of quick things and you'll be in. The only thing we truly need is your birthday — it helps us tell your stories at your pace.",
  begin: "Let's begin",
  birthdayTitle: "Before we go in — when were you born?",
  birthdayBody:
    "This is the one thing we ask for. It shapes the questions and the pace we'll use with you later. Nothing else on this screen is required.",
  sayItOutLoud: "Say it out loud",
  voiceUnavailableFields: "Voice isn't available here yet — use the fields below.",
  monthLabel: "Month",
  dayLabel: "Day",
  yearLabel: "Year",
  oneMoment: "One moment…",
  continue: "Continue",
  destinationTitle: (firstName: string) => `You're in, ${firstName}. Where to first?`,
  destinationBody: "You can always do the other one later — there's no wrong choice here.",
  primaryBadge: "PRIMARY",
  hubCardTitle: "Go to the hub",
  hubCardBody: "See your family's stories and start asking questions right away.",
  tellStoryDuration: "ABOUT 12 MINUTES",
  tellStoryTitle: "Tell your story",
  tellStoryBody:
    "Answer a few gentle questions so your family has something to ask you about.",
  questionProgress: (i: number, total: number) => `QUESTION ${i} OF ${total}`,
  voiceUnavailableType: "Voice isn't available here yet — type your answer below.",
  typeInstead: "Type instead",
  saving: "Saving…",
  finish: "Finish",
  next: "Next",
  doneEyebrow: "Thank you",
  doneTitle: "That's a beautiful start.",
  doneBody:
    "Your family will see these and have something to ask you about. There's always more to tell whenever you're ready.",
  takeMeToHub: "Take me to the hub",
  takeMeToHubArrow: "Take me to the hub →",
  // `key` is a stable structural id (not copy); chip/prompt/placeholder/voiceLabel are copy.
  questions: [
    {
      key: "birthplace",
      chip: "Born in",
      prompt: "Where were you born?",
      placeholder: "e.g. Lafayette, Louisiana",
      voiceLabel: "Tap to answer",
    },
    {
      key: "placesLived",
      chip: "Lived in",
      prompt: "Where have you lived since?",
      placeholder: "e.g. New Orleans, then Houston",
      voiceLabel: "Tap to answer",
    },
    {
      key: "keyMoments",
      chip: "A moment",
      prompt: "What's one moment you'd want remembered?",
      placeholder: "e.g. The summer we drove out to the coast",
      voiceLabel: "Tap to answer",
    },
  ],
} as const;
