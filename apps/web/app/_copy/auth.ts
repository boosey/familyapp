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
      "Tell Me Again is a private home for your family's stories — told in the voices of the people who lived them, and kept for everyone who comes after.",
    primaryCta: "Start your family",
    findCta: "Find your family",
    signUp: "Sign up",
    signIn: "Sign in",
    scrollCue: "How it works",
    narratorNote:
      "Invited to share a memory? Follow your personal invite link to join the family in a couple of minutes.",
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
          title: "They tell it",
          body:
            "They respond right from their phone's browser — no app to install, just a few minutes.",
        },
        {
          n: "03",
          title: "It's kept",
          body:
            "We transcribe it gently and keep it in your family's private archive — searchable, safe, and there for years to come.",
        },
      ],
    },
    photos: {
      eyebrow: "Photos, too",
      title: "Bring in the photos your stories live in.",
      body:
        "Upload photos straight from your device — or connect Google Photos to bring in the ones already there — and attach them to a memory. The wedding, the old kitchen, the road trip: a photograph pulls the story out of the person who was in it — who's there, where it was, what happened next. Your photos are used only to help your family tell and keep these stories — never sold, shared, or used for advertising.",
    },
    why: {
      eyebrow: "Why start now",
      title: "A family's record only grows once someone starts it.",
      body:
        "Most of what a family knows lives in one or two people — and in a shoebox nobody labeled. Tell Me Again gives those stories a home: easy to add to, safe to keep, and there for a grandchild who goes looking years from now. The sooner you begin, the more you'll have gathered while the storytellers are here to tell it.",
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
