// apps/web/app/_copy/auth.ts
// Sign-in, sign-up, dev sign-in, and landing-page copy.
export const auth = {
  signIn: {
    title: "Welcome back",
    subtitle: "Sign in to see your family's stories.",
    error: "That email and password don't match. Please try again.",
    newHere: "New here?",
    createFamily: "Create your family",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Your password",
    submit: "Sign in",
  },
  signUp: {
    errorEmailTaken: "That email already has an account. Try signing in instead.",
    errorMissing: "Please fill in your name, email, and a password.",
    title: "Create your family",
    subtitle:
      "Start a space for your family's stories. You can invite relatives and narrators once you're in.",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
    nameLabel: "Your name",
    namePlaceholder: "Sofia Boudreaux",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Choose a password",
    submit: "Create account",
  },
  devSignIn: {
    eyebrow: "dev · localhost",
    title: "Dev sign-in",
    body:
      "Local development only. One click to act as any seeded user — sets the mock session and takes you straight to the hub.",
    become: (name: string) => `Become ${name}`,
    signOut: "Sign out",
    backToHub: "‹ Back to hub",
  },
  landing: {
    eyebrow: "Est. 2026",
    tagline:
      "A warm place to gather your family's stories — and to help the people you love tell theirs before they're lost.",
    createFamily: "Create your family",
    signIn: "Sign in",
    narratorNote:
      "Invited a narrator to record? They open their own personal link — they never sign in here.",
  },
} as const;
