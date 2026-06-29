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
  // Door 2 → the /hub/about-you intake surface. A short structured walk (~6 quick prompts),
  // NOT a 12-minute story — copy reworded from the retired inline interview.
  introduceBadge: "A FEW MINUTES",
  introduceTitle: "Introduce yourself",
  introduceBody: "A few quick questions about you, so your family has something to ask about.",
  dobSaveError: "Something went wrong saving that. Please try again.",
} as const;
