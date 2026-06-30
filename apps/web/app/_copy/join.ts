// apps/web/app/_copy/join.ts
// Copy for the /join/[token] invite-acceptance surface.
export const join = {
  errorEmailTaken:
    "That email already has an account. Sign in first, then open this link again.",
  errorMissing: "Please fill in your name, email, and a password.",
  errorInviteUsed:
    "We couldn't complete the invite — it may have just been used or expired.",
  invalidTitle: "This invite is no longer valid",
  invalidBody:
    "It may have already been used, or it expired. Ask whoever invited you to send a fresh link — or sign in if you already have an account.",
  signIn: "Sign in",
  fromTheInvite: "FROM THE INVITE",
  aNewRelative: "A new relative",
  invitationEyebrow: "An invitation",
  invitedYou: (inviter: string, family: string) =>
    `${inviter} invited you to the ${family} family.`,
  confirm: "Confirm who you are and come on in.",
  genericError: "Something went wrong. Please try again.",
  relationshipLabel: "Your relationship",
  relationshipLabelHint: "(edit if it's not quite right)",
  relationshipPlaceholder: "e.g. Rosa's father",
  comeIn: "Come in",
  nameLabel: "Your name",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  passwordLabel: "Create a password",
  passwordPlaceholder: "Choose a password",
  submit: "Create login & come in",
  /** Clerk-path: the visitor already gave us the relationship label; Clerk collects credentials. */
  clerkContinue: "Continue to sign up",
} as const;
