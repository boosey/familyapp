// apps/web/app/_copy/welcome.ts
// Copy for the welcome onboarding flow.
export const welcome = {
  introEyebrowInvited: "You're invited in",
  introEyebrowDefault: "Welcome",
  // Name-free greetings: the stored name at this point may still be the email-prefix placeholder,
  // so the intro must never address the person by an unconfirmed name. We ask for their name next.
  greetingInvited: "Welcome to the family.",
  greetingDefault: "Welcome to Tell Me Again.",
  introBody:
    "A couple of quick things and you'll be in — your name, your birthday, and optionally a phone if you'd like texts from us. They help us tell your stories at your pace.",
  begin: "Let's begin",
  // Name step (asked before DOB) — the one place a real, user-entered name is guaranteed.
  nameTitle: "What should we call you?",
  nameBody:
    "This is the name your family will see and the name we'll use when we talk with you.",
  nameLabel: "Your name",
  namePlaceholder: "First and last name",
  birthdayTitle: "Before we go in — when were you born?",
  birthdayBody:
    "This is the one thing we ask for. It shapes the questions and the pace we'll use with you later. Nothing else on this screen is required.",
  // Optional phone + express SMS consent (Twilio TFV / TCPA) — recipient opts in for future texts.
  phoneTitle: "Want texts from Tell Me Again?",
  phoneBody:
    "Optional. Add your mobile number if you'd like SMS for family invitations and account notices. You can skip this.",
  phoneLabel: "Your mobile number",
  phonePlaceholder: "+1 555 123 0000",
  phoneInvalid: "That phone number doesn't look right — check the format and try again.",
  smsConsentLabel:
    "I agree to receive SMS text messages from Tell Me Again about family invitations and account notices. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.",
  smsConsentPrivacyLink: "Privacy Policy",
  smsConsentPrivacyAria: "Read our Privacy Policy (opens in the same tab)",
  smsConsentRequired: "Check the box to agree to SMS before continuing with a phone number — or clear the number to skip.",
  phoneSkip: "Not now",
  sayItOutLoud: "Say it out loud",
  voiceStop: "Tap when you're done",
  voiceOneMoment: "One moment…",
  voiceError: "Voice didn't catch that — you can type it below instead.",
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
