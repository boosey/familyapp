// apps/web/app/_copy/auth.ts
// Sign-in, sign-up, dev sign-in, and landing-page copy.
export const auth = {
  signIn: {
    title: "Welcome back",
    subtitle: "Sign in to Tell Me Again.",
    error: "That email and password don't match. Please try again.",
    newHere: "New here?",
    createAccount: "Create an account",
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
    subtitle: "Start keeping your family's stories.",
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
  // Landing page ("Tell Me Again") — the public front door and the URL Google's OAuth reviewer
  // visits as the app homepage. The product is uniformly "Tell Me Again" across every surface —
  // homepage, sign-in, welcome, invite emails, tab title, Privacy Policy, and the tellmeagain.app
  // domain — because Google's reviewer walks the full OAuth flow, and any surface still naming a
  // different product (formerly the internal "Family Chronicle") reads as an app-name mismatch and
  // fails verification (#154 / #153).
  landing: {
    brand: "Tell Me Again",
    eyebrow: "tellmeagain.app",
    refrain: "Tell me again.",
    lede:
      "Tell Me Again helps your family record and keep the stories of the people you love — in their own voice — before they're gone.",
    primaryCta: "Start your family",
    signUp: "Sign up",
    signIn: "Sign in",
    scrollCue: "How it works",
    narratorNote:
      "Invited to share a memory? You'll open your own personal link — there's nothing to sign into here.",
    what: {
      eyebrow: "What it is",
      title: "A home for your family's voices.",
      body:
        "Not another photo dump or family tree. Tell Me Again is a private place to gather the stories only your relatives can tell — how your grandparents met, the house on Plank Road, the year everything changed — and keep them safe for the people who come next.",
    },
    steps: {
      eyebrow: "How it works",
      title: "Three steps. Nothing for them to learn.",
      items: [
        {
          n: "01",
          title: "Ask",
          body:
            "Send someone you love a question — “Tell me about your first job” — by text or email.",
        },
        {
          n: "02",
          title: "They talk",
          body:
            "They answer out loud, in their own voice, from any phone. No account, no app, no setup.",
        },
        {
          n: "03",
          title: "It's kept",
          body:
            "We gently transcribe it and tuck it into your family's private archive, to hear again anytime.",
        },
      ],
    },
    why: {
      eyebrow: "Why now",
      title: "The stories go quiet sooner than we think.",
      body:
        "We all mean to write it down someday. Tell Me Again turns “someday” into a two-minute phone call — so a grandchild can still hear the laugh, the pause, the exact way it was told.",
    },
    trust: {
      eyebrow: "Yours, and only yours",
      title: "Private by default. You decide who hears what.",
      body:
        "Your family's memories belong to your family. Nothing is shared unless you choose to share it, and we never sell your information or use your stories to train advertising or AI models.",
      privacyCta: "Read our Privacy Policy",
    },
    closing: {
      title: "Start keeping your family's stories.",
      body: "It takes one question to begin.",
    },
    footer: {
      tagline: "Family voices, kept for the people who come next.",
      privacy: "Privacy Policy",
      contact: "Contact",
    },
  },
} as const;
