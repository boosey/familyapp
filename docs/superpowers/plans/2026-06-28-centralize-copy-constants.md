# Centralize UI Copy + Domain Numeric Constants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract user-facing display copy from `apps/web` into namespaced TypeScript message modules, and collect domain numeric constants into a `constants.ts` per package — a behavior-preserving refactor that is also the i18n on-ramp.

**Architecture:** Copy lives in `apps/web/app/_copy/*` as `as const` objects keyed by route-group namespace; static strings are literals, dynamic strings are arrow functions whose params map to future ICU placeholders. Numeric constants move to `<package>/src/constants.ts` (or `apps/web/lib/constants.ts`), with public re-exports preserved so external APIs don't break.

**Tech Stack:** TypeScript (strict, ESM, `verbatimModuleSyntax`), Next.js 15 / React 19, Vitest, pnpm workspaces.

**Source of truth:** Spec at `docs/superpowers/specs/2026-06-28-centralize-copy-constants-design.md`. The exhaustive string + constant inventories are in **Appendix A** (copy) and **Appendix B** (numbers) of this document — they are the authoritative content to extract.

---

## Conventions for every task

- **Copy modules:** `apps/web/app/app/_copy/<ns>.ts` exports `export const <ns> = { ... } as const;`. Static = string literal. Dynamic (contains `${…}`) = arrow function, e.g. `minsAgo: (n: number) => \`${n} min ago\``. Consumers import via `import { <ns> } from "@/app/_copy";`.
- **Numeric constants:** `SCREAMING_SNAKE_CASE`, unit-suffixed (`_MS`/`_BYTES`/`_CHARS`/`_TOKENS`/`_DAYS`/`_TURNS`/`_COUNT`). Definition moves to `constants.ts`; the original definition site is deleted and replaced by an import. **If the const is re-exported as public API, preserve that re-export.**
- **Find-all-references before moving a constant:** run
  `grep -rn "<CONST_NAME>" --include=*.ts packages apps | grep -v .next`
  and update every site (including `index.ts` re-exports and tests).
- **Do not touch:** route paths, discriminant/enum string values, CSS var strings, `className`, DOM `name=` attributes, `dev-seed.ts` fixtures, HTTP/SQLSTATE codes.
- **Commit after every task.** Use Co-Authored-By trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Verification commands** (note: `apps/web` has no component tests today, so its safety net is typecheck + build):
  - Web copy tasks: `pnpm --filter @chronicle/web exec tsc --noEmit`
  - Package constant tasks: `pnpm --filter @chronicle/<pkg> typecheck && pnpm --filter @chronicle/<pkg> test`

---

## Task 1: Scaffold the `_copy` directory + barrel

**Files:**
- Create: `apps/web/app/_copy/index.ts`
- Create: `apps/web/app/_copy/common.ts`

- [ ] **Step 1: Create `common.ts` with a single sentinel entry**

```ts
// apps/web/app/_copy/common.ts
// Shared, cross-route display copy. Static strings are literals; dynamic
// strings are arrow functions whose params become i18n placeholders later.
export const common = {
  appName: "Family Chronicle",
} as const;
```

- [ ] **Step 2: Create the barrel**

```ts
// apps/web/app/_copy/index.ts
// Namespaced UI copy. One namespace per route group. Add new namespaces here
// as they are created. A later next-intl migration serializes these objects.
export { common } from "./common";
```

- [ ] **Step 3: Verify the alias resolves**

Replace the literal `"Family Chronicle"` in `apps/web/app/page.tsx:39` with `{common.appName}` and add `import { common } from "@/app/_copy";` at the top.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit`
Expected: PASS (proves `@/app/_copy` resolves and `as const` consumption typechecks).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/page.tsx
git commit -m "feat(web): scaffold _copy namespaced UI copy modules"
```

---

## Task 2: `common.ts` — shared copy

**Files:**
- Modify: `apps/web/app/_copy/common.ts`
- Modify (consumers): `app/_auth/AuthScreen.tsx`, `app/_kindred/KindredAccountMenu.tsx`, `app/_kindred/KindredFontScale.tsx`, `app/_kindred/KindredListenBar.tsx`, `app/_kindred/KindredVoiceButton.tsx`, `app/_kindred/KindredStoryCard.tsx`

**Scope:** Appendix A → COMMON section, **plus** the two shared cross-route groups that belong here:
- **Audience tiers** (duplicated in `AnswerFlow.tsx` and `ApprovalRecorder.tsx`): labels `My whole family`/`Just one branch`/`Anyone` and descs `Everyone in the family`/`A chosen part of the family`/`Shared openly`.
- **Relative-time fragments** (duplicated in `QuestionsTab.tsx` and `AnswerFlow.tsx`): `just now`, `${n} min ago`, `${n}h ago`.
- **Month names** (from `WelcomeFlow.tsx` MONTHS array) and **font-scale labels** (from `KindredFontScale.tsx`).

- [ ] **Step 1: Expand `common.ts`**

```ts
// apps/web/app/_copy/common.ts
export const common = {
  appName: "Family Chronicle",

  account: {
    yourAccount: "Your account",
    accountMenu: "Account menu",
  },

  fontScale: {
    labels: ["Smallest text", "Small text", "Medium text", "Large text", "Largest text"],
    control: "Text size",
  },

  listenBar: {
    seek: "Seek",
    startOver: "Start over",
    back10: "Back 10 seconds",
    forward10: "Forward 10 seconds",
    nextStory: "Next story",
    play: "Play",
    pause: "Pause",
  },

  voiceButton: {
    oneMoment: "One moment…",
    listening: "Listening…",
    tapToSpeak: "Tap to speak",
  },

  storyCard: {
    photo: "photo",
    pinned: "Pinned",
    badgeNew: "New",
    recordedTitle: (label: string) => `Recorded ${label}`,
  },

  authScreenBrand: "Family Chronicle",

  // Shared audience tiers (used by AnswerFlow + ApprovalRecorder)
  audienceTiers: {
    family: { label: "My whole family", desc: "Everyone in the family" },
    branch: { label: "Just one branch", desc: "A chosen part of the family" },
    public: { label: "Anyone", desc: "Shared openly" },
  },

  relativeTime: {
    justNow: "just now",
    minsAgo: (n: number) => `${n} min ago`,
    hrsAgo: (n: number) => `${n}h ago`,
  },

  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
} as const;
```

- [ ] **Step 2: Update the COMMON consumers**

For each file in the Files list, add `import { common } from "@/app/_copy";` and replace the literal(s) per Appendix A. Examples:
- `KindredFontScale.tsx`: replace the local `LABELS` array with `common.fontScale.labels`; `aria-label="Text size"` → `aria-label={common.fontScale.control}`; the dynamic `${LABELS[idx]}` usages read from `common.fontScale.labels[idx]`.
- `KindredListenBar.tsx`: `aria-label="Seek"` → `{common.listenBar.seek}`; `playing ? "Pause" : "Play"` → `playing ? common.listenBar.pause : common.listenBar.play`; titles likewise.
- `KindredVoiceButton.tsx`: the `"One moment…"/"Listening…"/"Tap to speak"` branch → `common.voiceButton.*`.
- `KindredStoryCard.tsx`: `"photo"`, `"Pinned"`, `"New"`, and `title={\`Recorded ${recordedLabel}\`}` → `common.storyCard.recordedTitle(recordedLabel)`.
- `KindredAccountMenu.tsx`: the two aria-labels → `common.account.*`.
- `AuthScreen.tsx`: `"Family Chronicle"` → `{common.authScreenBrand}`.

Leave the duplicated audience-tier and relative-time call sites for now; their consuming tasks (5/6/8) will switch them to `common.*`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/_copy/common.ts apps/web/app/_auth apps/web/app/_kindred
git commit -m "feat(web): extract shared UI copy into _copy/common"
```

---

## Task 3: `auth.ts` — sign-in / sign-up / dev / landing

**Files:**
- Create: `apps/web/app/_copy/auth.ts`
- Modify: `apps/web/app/_copy/index.ts` (add `export { auth } from "./auth";`)
- Modify (consumers): `app/sign-in/page.tsx`, `app/sign-up/page.tsx`, `app/dev/sign-in/page.tsx`, `app/page.tsx`

**Scope:** Appendix A → AUTH section. (`app/page.tsx` keeps `common.appName` from Task 1; add the rest of its landing copy here under `auth.landing`.)

- [ ] **Step 1: Create `auth.ts`**

```ts
// apps/web/app/_copy/auth.ts
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
```

- [ ] **Step 2: Add to barrel**

Append to `apps/web/app/_copy/index.ts`: `export { auth } from "./auth";`

- [ ] **Step 3: Update consumers**

Add `import { auth } from "@/app/_copy";` (and keep `common` import in `page.tsx`) and replace each literal per Appendix A → AUTH.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/sign-in apps/web/app/sign-up apps/web/app/dev apps/web/app/page.tsx
git commit -m "feat(web): extract auth + landing copy into _copy/auth"
```

---

## Task 4: `families.ts` — find / new / start

**Files:**
- Create: `apps/web/app/_copy/families.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Modify (consumers): `app/families/find/page.tsx`, `app/families/new/page.tsx`, `app/families/start/page.tsx`

**Scope:** Appendix A → FAMILIES section.

- [ ] **Step 1: Create `families.ts`**

```ts
// apps/web/app/_copy/families.ts
export const families = {
  find: {
    statusWaiting: "Waiting for the steward",
    statusApproved: "Approved — welcome in",
    statusNotAccepted: "Not accepted",
    title: "Find your family",
    intro:
      "Search for a family a relative already created, then ask to join. The steward approves every request.",
    requestSent:
      "Your request is on its way — it's waiting for the family's steward to say yes.",
    requestFailed:
      "We couldn't send that request — you may already be a member, or already have a request waiting for that family.",
    searchPlaceholder: "Search by family name, a relative's name, or describe them…",
    search: "Search",
    noMatches: (query: string) => `No families matched "${query}". Try another name or spelling.`,
    resultMeta: (steward: string, reason: string) =>
      `STEWARD · ${steward.toUpperCase()} · MATCH: ${reason.toUpperCase()}`,
    notePlaceholder: 'Add a note for the steward (optional) — e.g. "I\'m Rosa\'s cousin."',
    requestToJoin: "Request to join",
    yourRequests: "Your requests",
  },
  new: {
    title: "Name your family",
    intro: "This is the space your stories live in. You can change the details later.",
    errorNoName: "Please give your family a name.",
    nameLabel: "Family name",
    namePlaceholder: "Boudreaux",
    descLabel: "Description (optional)",
    descPlaceholder: "The Boudreaux family of Lafayette, Louisiana.",
    discoverableLabel: "Let other relatives find this family",
    discoverableHint: "They can search for it and ask to join. You approve every request.",
    submit: "Create family",
  },
  start: {
    title: "Let's find your family",
    intro: "Start a brand-new family space, or join one a relative has already created.",
    freshEyebrow: "Start fresh",
    freshTitle: "Start a new family",
    freshBody:
      "Name your family and become its steward. You'll invite relatives and narrators next.",
    joinEyebrow: "Join existing",
    joinTitle: "Find your family",
    joinBody: "Search for a family a relative already set up, and ask to join it.",
  },
} as const;
```

> Note: `find/page.tsx:179` and `:289` build their text with a `STATUS_LABEL`/query interpolation — keep the existing logic, feed it `families.find.noMatches(query)` and the `statusWaiting/Approved/NotAccepted` values.

- [ ] **Step 2: Add to barrel** — `export { families } from "./families";`

- [ ] **Step 3: Update consumers** per Appendix A → FAMILIES.

- [ ] **Step 4: Typecheck** — `pnpm --filter @chronicle/web exec tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/families
git commit -m "feat(web): extract families copy into _copy/families"
```

---

## Task 5: `welcome.ts` — welcome flow

**Files:**
- Create: `apps/web/app/_copy/welcome.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Modify (consumers): `app/welcome/WelcomeFlow.tsx`

**Scope:** Appendix A → WELCOME section. Use `common.months` (Task 2) for the MONTHS array. The `QUESTIONS` array (prompt/voiceLabel/placeholder) moves here as structured data.

- [ ] **Step 1: Create `welcome.ts`**

```ts
// apps/web/app/_copy/welcome.ts
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
```

> Move the whole `QUESTIONS` array out of `WelcomeFlow.tsx` and point the component at `welcome.questions` (keep the `InterviewQuestion` type in the component, or import the inferred type). The `key` field stays as the stable id; the chip/prompt/placeholder/voiceLabel strings are the copy being centralized.

- [ ] **Step 2: Add to barrel** — `export { welcome } from "./welcome";`

- [ ] **Step 3: Update `WelcomeFlow.tsx`** — replace MONTHS with `common.months`, QUESTIONS with `welcome.questions`, and all literals per Appendix A.

- [ ] **Step 4: Typecheck** — `pnpm --filter @chronicle/web exec tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/welcome
git commit -m "feat(web): extract welcome-flow copy into _copy/welcome"
```

---

## Task 6: `capture.ts` — narrator capture + approval

**Files:**
- Create: `apps/web/app/_copy/capture.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Modify (consumers): `app/s/[token]/page.tsx`, `app/s/[token]/NarratorRecorder.tsx`, `app/s/[token]/approve/[storyId]/page.tsx`, `app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx`

**Scope:** Appendix A → CAPTURE section. `ApprovalRecorder.tsx`'s TIERS labels/descs switch to `common.audienceTiers` (Task 2).

- [ ] **Step 1: Create `capture.ts`**

```ts
// apps/web/app/_copy/capture.ts
export const capture = {
  resting: {
    welcome: "Welcome.",
    body:
      "This link is resting for now. Whoever invited you will help you get started again.",
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
  },
} as const;
```

- [ ] **Step 2: Add to barrel** — `export { capture } from "./capture";`

- [ ] **Step 3: Update consumers** per Appendix A → CAPTURE; replace `ApprovalRecorder` TIERS strings with `common.audienceTiers`.

- [ ] **Step 4: Typecheck** — `pnpm --filter @chronicle/web exec tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/s
git commit -m "feat(web): extract capture + approval copy into _copy/capture"
```

---

## Task 7: `join.ts` — invite acceptance

**Files:**
- Create: `apps/web/app/_copy/join.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Modify (consumers): `app/join/[token]/page.tsx`

**Scope:** Appendix A → JOIN section.

- [ ] **Step 1: Create `join.ts`**

```ts
// apps/web/app/_copy/join.ts
export const join = {
  errorEmailTaken: "That email already has an account. Sign in first, then open this link again.",
  errorMissing: "Please fill in your name, email, and a password.",
  errorInviteUsed: "We couldn't complete the invite — it may have just been used or expired.",
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
  relationshipLabel: "Your relationship (edit if it's not quite right)",
  relationshipPlaceholder: "e.g. Rosa's father",
  comeIn: "Come in",
  nameLabel: "Your name",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  passwordLabel: "Create a password",
  passwordPlaceholder: "Choose a password",
  submit: "Create login & come in",
} as const;
```

- [ ] **Step 2: Add to barrel** — `export { join } from "./join";`

- [ ] **Step 3: Update consumer** per Appendix A → JOIN.

- [ ] **Step 4: Typecheck** — `pnpm --filter @chronicle/web exec tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/_copy apps/web/app/join
git commit -m "feat(web): extract join-invite copy into _copy/join"
```

---

## Task 8: `hub.ts` — hub shell + tabs + answer flow + story detail

**Files:**
- Create: `apps/web/app/_copy/hub.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Modify (consumers): `app/hub/page.tsx`, `app/hub/HubTabs.tsx`, `app/hub/tabs/StoriesTab.tsx`, `app/hub/tabs/QuestionsTab.tsx`, `app/hub/tabs/AskTab.tsx`, `app/hub/tabs/AsksTab.tsx`, `app/hub/tabs/InviteTab.tsx`, `app/hub/tabs/RequestsTab.tsx`, `app/hub/tabs/StoriesBrowser.tsx`, `app/hub/tabs/CopyButton.tsx`, `app/hub/answer/[askId]/page.tsx`, `app/hub/answer/[askId]/AnswerFlow.tsx`, `app/hub/answer/[askId]/actions.ts`, `app/hub/stories/[id]/page.tsx`

**Scope:** Appendix A → HUB section. This is the largest task; sub-section `hub.ts` by area (`shell`, `tabs`, `stories`, `questions`, `ask`, `asks`, `invite`, `requests`, `browser`, `answer`, `actions`, `storyDetail`). `QuestionsTab`/`AnswerFlow` relative-time → `common.relativeTime`; `AnswerFlow`/`ApprovalRecorder` already share `common.audienceTiers`.

- [ ] **Step 1: Create `hub.ts`**

Build one `as const` object with these sub-keys. Copy each string verbatim from Appendix A → HUB; convert each DYNAMIC entry to an arrow function with the noted params (e.g. `askedBy: (name: string) => \`${name.toUpperCase()} ASKED\``, `ofTotal: (shown: number, total: number) => …`, `storyCount: (n: number) => \`${n} ${n === 1 ? "story" : "stories"}\``). Skeleton:

```ts
// apps/web/app/_copy/hub.ts
export const hub = {
  shell: {
    brand: "Family Chronicle",
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
  questions: {
    title: "Questions for you",
    intro: "Your family asked these. Answer whenever you're ready — there's no rush.",
    caughtUp: "You're all caught up. Nothing waiting.",
    askedBy: (name: string) => `${name.toUpperCase()} ASKED`,
    recordedAt: (label: string) => `RECORDED ${label.toUpperCase()}`,
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
    intro: "The questions you've sent, and where they are.",
    empty: "You haven't asked anything yet.",
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
    emailLabel: "Their email (optional)",
    emailPlaceholder: "rosa@example.com",
    relationshipLabel: "Relationship (optional)",
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
    everyones: "everyone's",
    possessive: (person: string) => `${person}'s`,
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
    askedBy: (name: string) => `${name.toUpperCase()} ASKED`,
    assembling: "Putting your story together…",
    assemblingSub: "This takes just a moment.",
    recordedAt: (label: string) => `RECORDED ${label.toUpperCase()}`,
    whoShouldHear: "Who should hear this?",
    shareWithFamily: "Share with family",
    reRecord: "Re-record",
    discard: "Discard",
    micError:
      "Something went wrong with the microphone. Make sure you've allowed microphone access, then refresh the page to try again.",
    listeningTapStop: "Listening… tap to stop",
    oneMoment: "One moment…",
    tapToSpeak: "Tap to speak",
    takeYourTime: "Take your time. Long silences are fine.",
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
    back: "‹ Stories",
    byline: (narrator: string, recordedAt: string) =>
      `Told by ${narrator} · Recorded ${recordedAt}`,
    noProse:
      "No prose yet — the original recording above is the whole story for now.",
  },
} as const;
```

- [ ] **Step 2: Add to barrel** — `export { hub } from "./hub";`

- [ ] **Step 3: Update consumers**

Work file-by-file through the Files list. For each, add `import { hub } from "@/app/_copy";` (plus `common` where it uses relativeTime / audienceTiers) and replace literals per Appendix A → HUB. Keep all surrounding logic (date math, `.toUpperCase()` call sites that are already inside the arrow functions, conditionals) intact — only the literal text moves.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Build (catches server/client boundary + JSX issues across the whole app)**

Run: `pnpm --filter @chronicle/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/_copy apps/web/app/hub
git commit -m "feat(web): extract hub copy into _copy/hub"
```

---

## Task 9: `apps/web/lib/constants.ts` — web domain numbers

**Files:**
- Create: `apps/web/lib/constants.ts`
- Modify: `apps/web/lib/auth-mock.ts`
- Modify: `apps/web/app/_kindred/font-scale-constants.ts` (trim to the excluded storage key)
- Modify (consumers): `apps/web/app/_kindred/KindredFontScale.tsx`, `apps/web/app/layout.tsx`

**Scope:** Appendix B → apps/web/lib, **including** the font-scale numeric knobs created after the original inventory. **Excluded:** `FONT_SIZE_STORAGE_KEY` (a localStorage key — internal structural identifier, not a domain knob) stays out of `lib/constants.ts`.

- [ ] **Step 1: Create `constants.ts`**

```ts
// apps/web/lib/constants.ts
// Domain numeric knobs for the web app. Tune here, not at call sites.

/** Derived-key length (bytes) for scrypt password hashing. */
export const SCRYPT_KEY_LENGTH_BYTES = 64;

/** Random salt size (bytes) for password hashing. */
export const PASSWORD_SALT_BYTES = 16;

/**
 * Root font sizes (in points) for each step of the reading-size picker,
 * smallest → largest. The Kindred type scale is in `rem`, so setting the root
 * font size rescales every token at once. Single source of truth for both the
 * picker UI and the pre-paint script in layout.tsx.
 */
export const FONT_SIZE_STEPS_PT = [8, 10, 12, 14, 18] as const;

/** Default reading-size step before the narrator chooses one. */
export const DEFAULT_FONT_SIZE_INDEX = 1;
```

- [ ] **Step 2: Move the password consts**

In `auth-mock.ts`: delete `const SCRYPT_KEYLEN = 64;`, replace the inline `randomBytes(16)` with `randomBytes(PASSWORD_SALT_BYTES)`, replace `scryptSync(..., SCRYPT_KEYLEN)` with `SCRYPT_KEY_LENGTH_BYTES`, and add `import { SCRYPT_KEY_LENGTH_BYTES, PASSWORD_SALT_BYTES } from "./constants";`. Confirm no other file referenced `SCRYPT_KEYLEN`:
`grep -rn "SCRYPT_KEYLEN" --include=*.ts apps`

- [ ] **Step 3: Move the font-scale numbers; keep the storage key local**

Edit `apps/web/app/_kindred/font-scale-constants.ts` so it contains **only** the excluded storage key (move the two numeric consts to `lib/constants.ts`):

```ts
// apps/web/app/_kindred/font-scale-constants.ts
/** localStorage key holding the chosen reading-size step index. */
export const FONT_SIZE_STORAGE_KEY = "kin-font-size";
```

Update consumers:
- `KindredFontScale.tsx`: import `FONT_SIZE_STEPS_PT`, `DEFAULT_FONT_SIZE_INDEX` from `@/lib/constants`; keep importing `FONT_SIZE_STORAGE_KEY` from `./font-scale-constants`. (Its display labels already come from `common.fontScale.labels` via Task 2.)
- `layout.tsx`: the pre-paint inline script reads the steps + default index — import `FONT_SIZE_STEPS_PT` and `DEFAULT_FONT_SIZE_INDEX` from `@/lib/constants` and interpolate their values into the script string exactly as before; keep `FONT_SIZE_STORAGE_KEY` from `./_kindred/font-scale-constants`.

Find every reference before/after the move:
`grep -rn "FONT_SIZE_STEPS_PT\|DEFAULT_FONT_SIZE_INDEX\|FONT_SIZE_STORAGE_KEY" --include=*.ts --include=*.tsx apps/web | grep -v .next`

- [ ] **Step 4: Typecheck + test + build**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit && pnpm --filter @chronicle/web test && pnpm --filter @chronicle/web build`
Expected: PASS. (Build matters here — the pre-paint script in `layout.tsx` is exercised at build/render time.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/constants.ts apps/web/lib/auth-mock.ts apps/web/app/_kindred/font-scale-constants.ts apps/web/app/_kindred/KindredFontScale.tsx apps/web/app/layout.tsx
git commit -m "refactor(web): collect domain numeric constants into lib/constants"
```

---

## Task 10: `packages/capture/src/constants.ts`

**Files:**
- Create: `packages/capture/src/constants.ts`
- Modify: `packages/capture/src/sessions.ts`

**Scope:** Appendix B → packages/capture/src.

- [ ] **Step 1: Confirm baseline green** — `pnpm --filter @chronicle/capture test` → PASS.

- [ ] **Step 2: Create `constants.ts`**

```ts
// packages/capture/src/constants.ts
/** Default TTL (days) for login-free link session tokens. */
export const LINK_SESSION_DEFAULT_TTL_DAYS = 30;

/** Milliseconds in one day — time-unit conversion. */
export const MILLISECONDS_PER_DAY = 86_400_000;

/** Entropy (bytes) for link-session token generation (256 bits). */
export const LINK_SESSION_TOKEN_ENTROPY_BYTES = 32;
```

- [ ] **Step 3: Move the consts in `sessions.ts`**

Delete the local `DEFAULT_TTL_DAYS` and `MS_PER_DAY` definitions; replace `randomBytes(32)` with `randomBytes(LINK_SESSION_TOKEN_ENTROPY_BYTES)`, `DEFAULT_TTL_DAYS` usage with `LINK_SESSION_DEFAULT_TTL_DAYS`, `MS_PER_DAY` with `MILLISECONDS_PER_DAY`. Add `import { LINK_SESSION_DEFAULT_TTL_DAYS, MILLISECONDS_PER_DAY, LINK_SESSION_TOKEN_ENTROPY_BYTES } from "./constants";`. Check for external refs: `grep -rn "DEFAULT_TTL_DAYS\|MS_PER_DAY" --include=*.ts packages/capture` (these are file-local; if `index.ts` re-exports any, preserve it).

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chronicle/capture typecheck && pnpm --filter @chronicle/capture test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/constants.ts packages/capture/src/sessions.ts
git commit -m "refactor(capture): collect domain numeric constants into constants.ts"
```

---

## Task 11: `packages/core/src/constants.ts`

**Files:**
- Create: `packages/core/src/constants.ts`
- Modify: `packages/core/src/asks.ts`, `packages/core/src/family-search.ts`, `packages/core/src/invitations.ts`

**Scope:** Appendix B → packages/core/src (8 constants).

- [ ] **Step 1: Confirm baseline green** — `pnpm --filter @chronicle/core test` → PASS.

- [ ] **Step 2: Create `constants.ts`**

```ts
// packages/core/src/constants.ts
/** Default page size for pending asks returned to the interviewer. */
export const PENDING_ASKS_DEFAULT_LIMIT = 20;

/** Family-search scoring weights (name highest → member lowest). */
export const FAMILY_SEARCH_WEIGHT_NAME = 4;
export const FAMILY_SEARCH_WEIGHT_STEWARD = 3;
export const FAMILY_SEARCH_WEIGHT_DESCRIPTION = 2;
export const FAMILY_SEARCH_WEIGHT_MEMBER = 1;

/** Default number of family-search results returned. */
export const FAMILY_SEARCH_DEFAULT_LIMIT = 10;

/** Default TTL (ms) for member invitation tokens (14 days). */
export const MEMBER_INVITATION_DEFAULT_TTL_MS = 14 * 86_400_000;

/** Entropy (bytes) for member invitation token generation (256 bits). */
export const MEMBER_INVITATION_TOKEN_ENTROPY_BYTES = 32;
```

- [ ] **Step 3: Move the consts**

- `asks.ts`: `opts.limit ?? 20` → `opts.limit ?? PENDING_ASKS_DEFAULT_LIMIT` (both line 218 and the constraint at line 233 if it repeats the literal).
- `family-search.ts`: delete local `WEIGHT_*` consts, use `FAMILY_SEARCH_WEIGHT_*`; `query.limit ?? 10` → `FAMILY_SEARCH_DEFAULT_LIMIT`.
- `invitations.ts`: delete local `DEFAULT_TTL_MS`, use `MEMBER_INVITATION_DEFAULT_TTL_MS`; `randomBytes(32)` → `randomBytes(MEMBER_INVITATION_TOKEN_ENTROPY_BYTES)`.
- Add the corresponding `import { … } from "./constants";` to each file.
- Check the architecture allowlist is unaffected and no public re-exports break:
  `grep -rn "WEIGHT_NAME\|DEFAULT_TTL_MS\|PENDING_ASKS" --include=*.ts packages/core/src/index.ts`

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chronicle/core typecheck && pnpm --filter @chronicle/core test`
Expected: PASS (architecture.test.ts must stay green — only `./constants` imports were added).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constants.ts packages/core/src/asks.ts packages/core/src/family-search.ts packages/core/src/invitations.ts
git commit -m "refactor(core): collect domain numeric constants into constants.ts"
```

---

## Task 12: `packages/pipeline/src/constants.ts`

**Files:**
- Create: `packages/pipeline/src/constants.ts`
- Modify: `packages/pipeline/src/render-story.ts`, `packages/pipeline/src/job-queue.ts`, `packages/pipeline/src/orchestrator.ts`

**Scope:** Appendix B → packages/pipeline/src (9 constants).

- [ ] **Step 1: Confirm baseline green** — `pnpm --filter @chronicle/pipeline test` → PASS.

- [ ] **Step 2: Create `constants.ts`**

```ts
// packages/pipeline/src/constants.ts
/** LLM temperature for story rendering (low = faithful to transcript). */
export const STORY_RENDER_LLM_TEMPERATURE = 0.2;

/** Hard cap on output tokens for story rendering. */
export const STORY_RENDER_MAX_OUTPUT_TOKENS = 4000;

/** Char caps for parsed LLM story fields. */
export const STORY_TITLE_MAX_CHARS = 200;
export const STORY_SUMMARY_MAX_CHARS = 400;

/** Max number of tags per story. */
export const STORY_TAGS_MAX_COUNT = 8;

/** Char caps for fallback story fields when JSON parse fails. */
export const STORY_TITLE_FALLBACK_MAX_CHARS = 80;
export const STORY_SUMMARY_FALLBACK_MAX_CHARS = 200;

/** Max retry attempts per job id in the in-process queue (spin-loop guard). */
export const PIPELINE_JOB_MAX_ATTEMPTS = 8;

/** Bounds on audio time-stretch speed factor. */
export const AUDIO_SPEED_FACTOR_MIN = 1.0;
export const AUDIO_SPEED_FACTOR_MAX = 2.0;
```

- [ ] **Step 3: Move the consts**

- `render-story.ts`: `temperature: 0.2` → `STORY_RENDER_LLM_TEMPERATURE`; `maxOutputTokens: 4000` → `STORY_RENDER_MAX_OUTPUT_TOKENS`; the `slice(0, 200)`/`slice(0, 400)`/`slice(0, 8)` and the `firstLineFallback(..., 80)`/`firstLineFallback(..., 200)` calls → the named consts above. Verify which literal maps to title vs summary vs fallback against Appendix B line numbers (101/105/110/102/106).
- `job-queue.ts`: delete `const MAX_ATTEMPTS_PER_JOB_ID = 8;`, use `PIPELINE_JOB_MAX_ATTEMPTS` (check it isn't re-exported: `grep -rn "MAX_ATTEMPTS_PER_JOB_ID" --include=*.ts packages/pipeline`).
- `orchestrator.ts`: `working.speedFactor < 1.0` → `< AUDIO_SPEED_FACTOR_MIN`; `> 2.0` → `> AUDIO_SPEED_FACTOR_MAX`.
- Add `import { … } from "./constants";` to each file.

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chronicle/pipeline typecheck && pnpm --filter @chronicle/pipeline test`
Expected: PASS (pipeline architecture/vendor-SDK scan stays green — only `./constants` imports added).

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/constants.ts packages/pipeline/src/render-story.ts packages/pipeline/src/job-queue.ts packages/pipeline/src/orchestrator.ts
git commit -m "refactor(pipeline): collect domain numeric constants into constants.ts"
```

---

## Task 13: `packages/interviewer/src/constants.ts`

**Files:**
- Create: `packages/interviewer/src/constants.ts`
- Modify: `packages/interviewer/src/behavior.ts`, `packages/interviewer/src/phraser.ts`, `packages/interviewer/src/turn-loop.ts`, `packages/interviewer/src/index.ts`

**Scope:** Appendix B → packages/interviewer/src (5 constants). **Public-API care:** `RAPPORT_THRESHOLD_TURNS`, `SILENCE_TOLERANCE_MS`, `MEMORY_LOOKBACK_COUNT` are re-exported from `index.ts:30-32` — the package's public surface must keep exporting them.

- [ ] **Step 1: Confirm baseline green** — `pnpm --filter @chronicle/interviewer test` → PASS.

- [ ] **Step 2: Create `constants.ts`**

```ts
// packages/interviewer/src/constants.ts
/** Min completed turns before high-sensitivity questions may be asked. */
export const RAPPORT_THRESHOLD_TURNS = 4;

/** Silence to tolerate (ms) before nudging the narrator. */
export const SILENCE_TOLERANCE_MS = 12_000;

/** Prior stories considered for cross-session memory + dedup. */
export const MEMORY_LOOKBACK_COUNT = 8;

/** LLM temperature for phrasing interviewer intents. */
export const INTERVIEWER_PHRASE_LLM_TEMPERATURE = 0.4;

/** Hard cap on output tokens for interviewer question phrasing. */
export const INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS = 250;
```

- [ ] **Step 3: Move the consts**

- `behavior.ts`: delete the three `export const RAPPORT_THRESHOLD_TURNS` / `SILENCE_TOLERANCE_MS` / `MEMORY_LOOKBACK_COUNT` definitions; import them from `./constants` and use them where the file references them.
- `phraser.ts`: `temperature: 0.4` → `INTERVIEWER_PHRASE_LLM_TEMPERATURE`; `maxOutputTokens: 250` → `INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS`; import from `./constants`.
- `turn-loop.ts`: change its import of `MEMORY_LOOKBACK_COUNT` / `SILENCE_TOLERANCE_MS` / `RAPPORT_THRESHOLD_TURNS` from `./behavior` to `./constants` (it currently imports them from behavior at lines 23/82-area).
- `index.ts`: change lines 30-32 to re-export the three public consts from `./constants` instead of `./behavior`, so the public API is unchanged. Verify: `grep -rn "RAPPORT_THRESHOLD_TURNS\|SILENCE_TOLERANCE_MS\|MEMORY_LOOKBACK_COUNT" --include=*.ts packages/interviewer/src` shows all sites point at `./constants`.

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chronicle/interviewer typecheck && pnpm --filter @chronicle/interviewer test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/interviewer/src/constants.ts packages/interviewer/src/behavior.ts packages/interviewer/src/phraser.ts packages/interviewer/src/turn-loop.ts packages/interviewer/src/index.ts
git commit -m "refactor(interviewer): collect domain numeric constants into constants.ts"
```

---

## Task 14: Full-workspace verification

**Files:** none (verification only)

- [ ] **Step 1: Whole-repo typecheck + tests + lint**

Run: `pnpm -r typecheck && pnpm -r test && pnpm -r lint`
Expected: ALL PASS. (Confirms the `core` and `pipeline` architecture tests still pass — no `@chronicle/db/content`, `@chronicle/db/client`, or vendor-SDK imports were introduced.)

- [ ] **Step 2: Web production build**

Run: `pnpm --filter @chronicle/web build`
Expected: PASS.

- [ ] **Step 3: Manual spot-check (behavior preservation)**

Start `pnpm --filter @chronicle/web dev` and confirm rendered copy is unchanged on three representative routes: the hub ask tab (`/hub?tab=ask`), the welcome flow (`/welcome`), and a capture page (`/s/<token>`). Copy must read byte-identical to pre-refactor.

- [ ] **Step 4: Final residual sweep**

Run: `grep -rn "SCRYPT_KEYLEN\|MS_PER_DAY\|DEFAULT_TTL_MS\|MAX_ATTEMPTS_PER_JOB_ID\|WEIGHT_NAME" --include=*.ts packages apps | grep -v constants.ts | grep -v .next`
Expected: no stale references to relocated constants outside `constants.ts`.

- [ ] **Step 5: Commit (if any spot-check fixups were needed)**

```bash
git add -A
git commit -m "chore: finalize copy + constants centralization"
```

---

## Appendix A — UI Copy Inventory (authoritative)

> Verbatim string inventory by namespace. Line numbers are hints — open the file and match the string. STATIC = literal; DYNAMIC = arrow function with the noted interpolation.

### COMMON

**app/_auth/AuthScreen.tsx**
- L54: `"Family Chronicle"` — STATIC — Server

**app/_kindred/KindredAccountMenu.tsx**
- L135: `"Your account"` (aria-label) — STATIC — Client
- L151: `"Account menu"` (aria-label) — STATIC — Client

**app/_kindred/KindredButton.tsx** — none (label is a prop)
**app/_kindred/KindredChip.tsx** — none

**app/_kindred/KindredFontScale.tsx**
- L21: `"Smallest text"`, `"Small text"`, `"Medium text"`, `"Large text"`, `"Largest text"` (LABELS array) — STATIC — Client
- L47: `"Text size"` (aria-label) — STATIC — Client
- L55: `${LABELS[idx]}` (aria-label) — DYNAMIC(idx) — Client
- L57: `${LABELS[idx]}` (title) — DYNAMIC(idx) — Client

**app/_kindred/KindredListenBar.tsx**
- L220: `"Seek"` (aria-label) — STATIC — Client
- L282: `"Start over"` (title) — STATIC — Client
- L288: `"Back 10 seconds"` (title) — STATIC — Client
- L299: `${playing ? "Pause" : "Play"}` (aria-label) — DYNAMIC(playing) — Client
- L324: `"Forward 10 seconds"` (title) — STATIC — Client
- L331: `"Next story"` (title) — STATIC — Client

**app/_kindred/KindredPromptCard.tsx** — `eyebrow`/`question` are caller-supplied props (not extracted here; callers supply copy)

**app/_kindred/KindredStoryCard.tsx**
- L146: `"photo"` — STATIC — Server
- L185: `Recorded ${recordedLabel}` (title) — DYNAMIC(recordedLabel) — Server
- L262: `"Pinned"` (aria-label) — STATIC — Server
- L295: `"New"` — STATIC — Server

**app/_kindred/KindredVoiceButton.tsx**
- L83: `"One moment…"` — STATIC — Client
- L85: `"Listening…"` — STATIC — Client
- L86: `"Tap to speak"` — STATIC — Client
- L104: `${caption}` (aria-label) — DYNAMIC(caption, caller-supplied)

### HUB

**app/hub/page.tsx**
- L74: `"Family Chronicle"`; L84: `"Sign in to see your family's stories."`; L88 label `"Sign in"`; L91 label `"Create your family"`; L129 `"Your Chronicle"`; L142 `"Stories"`; L145 `"Questions for you"`; L148 `"Ask a question"`; L149 `"Your asks"`; L150 `"Invite"`; L152 `"Requests"`; L157 label `"Your profile"`; L158 `"Settings"`; L159 `"Manage family"`; L160 `"Switch user"`; L161 `"Log out"` — all STATIC — Server

**app/hub/HubTabs.tsx**
- L68: `"Hub sections"` (aria-label) — STATIC — Client
- L88: `${tab.badge} unread` (aria-label) — DYNAMIC(tab.badge) — Client

**app/hub/HubTabsNav.tsx** — none

**app/hub/tabs/StoriesTab.tsx**
- L47: `"Untitled"`; L77: `"No stories yet. When someone shares a chronicle with you, their stories will appear here."` — STATIC — Server

**app/hub/tabs/QuestionsTab.tsx**
- L28: `"Questions for you"`; L39: `"Your family asked these. Answer whenever you're ready — there's no rush."`; L61: `"You're all caught up. Nothing waiting."` — STATIC — Server
- L85: `"just now"`; L86: `${diffMins} min ago` DYNAMIC(diffMins); L89: `${diffHrs}h ago` DYNAMIC(diffHrs) — Server (→ common.relativeTime)
- L117: `${item.askerSpokenName.toUpperCase()} ASKED` DYNAMIC; L140: `RECORDED ${recordedLabel.toUpperCase()}` DYNAMIC — Server
- L163: `"Review & approve"` / `"Answer"` — STATIC — Server

**app/hub/tabs/AskTab.tsx**
- L36: `"Sign in to ask a question."`; L75: `"Ask a question"`; L86: `"Your question goes into the queue. It will be asked next time they sit down to talk — never as an interruption."`; L92 eyebrow `"What would you love to hear?"`; L93 question `"A good ask is small and human — a name, a smell, a feeling, a Sunday."`; L99 `"For"`; L109 `"Your question"`; L115 placeholder `"e.g. What was your mother singing on Sunday mornings?"`; L118 label `"Send to the queue"` — STATIC — Server

**app/hub/tabs/AsksTab.tsx**
- L23: `"Sign in to see your asks."`; L55: `"Your asks"`; L66: `"The questions you've sent, and where they are."`; L93: `"You haven't asked anything yet."`; L163: `"Listen"`; L176: `"ANSWERED · PRIVATE"`; L189: `"IN THE QUEUE"` — STATIC — Server
- L141: `For ${m.targetSpokenName}:` — DYNAMIC(targetSpokenName) — Server

**app/hub/tabs/InviteTab.tsx**
- L147: `"Personal link — shown once"`; L196 title `"Link is ready"`; L197 blurb `"Send this to your narrator however you usually talk — text or email. Tapping it opens their recording page directly. There is no password."`; L199 note `"For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it."`; L209 title `"Invitation link is ready"`; L210 blurb `"Send this to your relative. Opening it lets them create a login and join your family — you don't have to set anything up for them."`; L212 note (same fingerprint note as L199); L230 `"Sign in to invite someone."`; L284 `"Invite a family member"`; L286 `"Send a relative a link to create their own login and join the family. They'll confirm who they are, then go through a short welcome."`; L291 `"Their name"`; L297 placeholder `"e.g. Rosa Esposito"`; L301 `"Their email (optional)"`; L306 placeholder `"rosa@example.com"`; L310 `"Relationship (optional)"`; L315 placeholder `"e.g. your cousin"`; L319 `"Family"`; L324 label `"Create invite link"`; L332 `"Invite a narrator to record"`; L333 `"Creates a personal link that opens the narrator's recording page. No login, no account — the link is the identity."`; L339 `"Narrator"`; L349 `"Family"`; L354 label `"Create link"` — STATIC — Server

**app/hub/tabs/RequestsTab.tsx**
- L51: `"Sign in to review join requests."`; L69: `"Requests to join"`; L80: `"People asking to join a family you steward. Approving adds them as a member."`; L107: `"No requests waiting right now."`; L174 label `"Approve"`; L178 label `"Decline"` — STATIC — Server

**app/hub/tabs/StoriesBrowser.tsx** (Client)
- L92-93: `${filtered.length} OF ${total}` / `${total} ${total === 1 ? "STORY" : "STORIES"}` DYNAMIC
- L95: `${filtered.length} stories match` / `1 story matches` DYNAMIC
- L169: `"Find stories"` STATIC
- L194: `${filtered.length} ${filtered.length === 1 ? "story" : "stories"}` DYNAMIC
- L266: placeholder `"Try a name, a place, or a moment…"` STATIC
- L290: `"Hmm — nothing matched. Try a name, a year, or a word from the story."` STATIC
- L308: `"Show me"`; L312: `"everyone's"` / `${person}'s` DYNAMIC; L320: `"stories about"`; L322: `"anything"` / `${filters.topic}` DYNAMIC; L327: `", from"`; L329: `"any time"` / `the ${filters.era}` DYNAMIC; L334: `"."`
- L347: `"Whose stories?"`; L349: `"About what?"`; L350: `"From when?"`; L379: `"Everyone"`; L388: `"Any era"`; L397: `"Anything"`; L425: `${resultSentence}` DYNAMIC; L430: `"Start over"`; L434: `"Done"`; L461: `"No stories match. Try widening your search."`; L470: `"Earlier memories"`; L580: `"The original recording"`; L606: `"Read the prose ›"`; L624: `"Open this story ›"`; L730: `"Any time"`

**app/hub/tabs/CopyButton.tsx**
- L36: `"Copied ✓"` / `"Copy"` — STATIC — Client

**app/hub/tabs/ClearInviteFlash.tsx** — none

**app/hub/answer/[askId]/page.tsx**
- L102: `"← Back to questions"` — STATIC — Server

**app/hub/answer/[askId]/AnswerFlow.tsx** (Client)
- L24-26: TIERS labels/descs `"My whole family"/"Everyone in the family"`, `"Just one branch"/"A chosen part of the family"`, `"Anyone"/"Shared openly"` → common.audienceTiers
- L57: `"just now"`; L58: `${diffMins} min ago` DYNAMIC; L60: `${diffHrs}h ago` DYNAMIC → common.relativeTime
- L198: `${askerName.toUpperCase()} ASKED` DYNAMIC
- L242: `"Putting your story together…"`; L252: `"This takes just a moment."`
- L275: `RECORDED ${shortDate(draft.recordedAt).toUpperCase()}` DYNAMIC
- L306: `"Who should hear this?"`; L370 `${opt.label}` / L379 `${opt.desc}` (from TIERS → common.audienceTiers); L400 `${actionError}` DYNAMIC
- L407 label `"Share with family"`; L419 label `"Re-record"`; L427 label `"Discard"`
- L454: `"Something went wrong with the microphone. Make sure you've allowed microphone access, then refresh the page to try again."`
- L484: `"Listening… tap to stop"`; L486: `"One moment…"`; L487: `"Tap to speak"`; L502: `"Take your time. Long silences are fine."`

**app/hub/answer/[askId]/actions.ts** (Server Action — thrown error strings shown to users)
- L31/79: `"Not signed in."`; L36/84/150: `"Invalid input."`; L46: `"This question is not for you."`; L52: `"That question has already been answered."`; L56: `"Recording was empty. Please try again."`; L65: `"Could not save your recording. Please try again."`; L90: `"Please pick an audience before sharing."`; L98: `"Story not found."`; L132: `"Something went wrong sharing your story. Please try again."`; L163: `"Could not remove the recording. Please try again."`

**app/hub/stories/[id]/page.tsx**
- L69: `"‹ Stories"`; L101: `Told by ${narratorName} · Recorded ${recordedAt}` DYNAMIC; L136: `"No prose yet — the original recording above is the whole story for now."` — Server

### FAMILIES

**app/families/find/page.tsx**
- L49: `"Waiting for the steward"`; L50: `"Approved — welcome in"`; L51: `"Not accepted"`; L103: `"Find your family"`; L114: `"Search for a family a relative already created, then ask to join. The steward approves every request."`; L132: `"Your request is on its way — it's waiting for the family's steward to say yes."`; L150: `"We couldn't send that request — you may already be a member, or already have a request waiting for that family."`; L162 placeholder `"Search by family name, a relative's name, or describe them…"`; L165 label `"Search"`; L223 placeholder `Add a note for the steward (optional) — e.g. "I'm Rosa's cousin."`; L227 label `"Request to join"`; L249 `"Your requests"` — STATIC — Server
- L179: `No families matched "{query}"…` DYNAMIC(query); L215: `STEWARD · ${r.stewardName.toUpperCase()} · MATCH: ${r.matchReason.toUpperCase()}` DYNAMIC; L289: `${STATUS_LABEL[r.status] ?? r.status}` DYNAMIC (uses L49-51 status labels)

**app/families/new/page.tsx**
- L88: `"Name your family"`; L99: `"This is the space your stories live in. You can change the details later."`; L116: `"Please give your family a name."`; L122: `"Family name"`; L128 placeholder `"Boudreaux"`; L132: `"Description (optional)"`; L136 placeholder `"The Boudreaux family of Lafayette, Louisiana."`; L157: `"Let other relatives find this family"`; L166: `"They can search for it and ask to join. You approve every request."`; L170 label `"Create family"` — STATIC — Server

**app/families/start/page.tsx**
- L107: `"Let's find your family"`; L118: `"Start a brand-new family space, or join one a relative has already created."`; L129 eyebrow `"Start fresh"`; L130 title `"Start a new family"`; L131 body `"Name your family and become its steward. You'll invite relatives and narrators next."`; L136 eyebrow `"Join existing"`; L137 title `"Find your family"`; L138 body `"Search for a family a relative already set up, and ask to join it."` — STATIC — Server

### WELCOME

**app/welcome/page.tsx** — none (props to WelcomeFlow)

**app/welcome/WelcomeFlow.tsx** (Client)
- L52-55: MONTHS array (Jan..Dec) → common.months
- L230: `"You're invited in"` / `"Welcome"`; L233: `Welcome to the family, ${firstName}.` DYNAMIC; L234: `"Welcome to Family Chronicle."`; L238: `"A couple of quick things and you'll be in. The only thing we truly need is your birthday — it helps us tell your stories at your pace."`; L242 label `"Let's begin"`
- L257: `"Before we go in — when were you born?"`; L259: `"This is the one thing we ask for. It shapes the questions and the pace we'll use with you later. Nothing else on this screen is required."`; L264 label `"Say it out loud"`; L266: `"Voice isn't available here yet — use the fields below."`
- L272/283 `"Month"`; L292/294 `"Day"`; L303/314 `"Year"`; L328: `"One moment…"` / `"Continue"`
- L345: `You're in, ${firstName}. Where to first?` DYNAMIC; L349: `"You can always do the other one later — there's no wrong choice here."`; L381: `"PRIMARY"`; L384: `"Go to the hub"`; L387: `"See your family's stories and start asking questions right away."`; L417: `"ABOUT 12 MINUTES"`; L420: `"Tell your story"`; L423: `"Answer a few gentle questions so your family has something to ask you about."`
- L485: `QUESTION ${qIndex + 1} OF ${QUESTIONS.length}` DYNAMIC; L487 `${q.prompt}`, L490 `${q.voiceLabel}`, L502 `${q.placeholder}` (from QUESTIONS array → welcome.questions); L492: `"Voice isn't available here yet — type your answer below."`; L497 label `"Type instead"`; L511: `"Saving…"` / `"Finish"` / `"Next"`
- L526 eyebrow `"Thank you"`; L527: `"That's a beautiful start."`; L530: `"Your family will see these and have something to ask you about. There's always more to tell whenever you're ready."`; L535 label `"Take me to the hub"`; L469 label `"Take me to the hub →"`

**app/welcome/actions.ts** — none

### CAPTURE

**app/s/[token]/page.tsx**
- L31: `"Welcome."`; L33: `"This link is resting for now. Whoever invited you will help you get started again."`; L84: `Conversation · ${dateLabel}` DYNAMIC; L111: `Hello, ${spokenName}.` DYNAMIC; L114: `"Whenever you're ready, tap the button and tell me anything you'd like. Take all the time you want."`; L117 eyebrow `${nextAsk ? \`${nextAsk.askerSpokenName} asked\` : "A thought to start with"}` DYNAMIC; L121: `"What's something from your day, or from long ago, that's been on your mind?"` — Server

**app/s/[token]/NarratorRecorder.tsx** (Client)
- L72: `"Thank you. Your family will love hearing this."`; L84: `"Let's pick this up another time. The person who invited you will check in soon."`; L96: `"Listening…"` / `"One moment…"` / `"Tap to speak"`

**app/s/[token]/approve/[storyId]/page.tsx** (Server)
- L41: `"Welcome."`; L53: `"This link is resting for now. Whoever invited you will help you get started again."`; L79: `"Thank you."`; L91: `"This one is already settled. You can close this window whenever you're ready."`; L129: `"Family Chronicle"`; L140: `"Your Story"`; L155: `"Ready to share this one?"`; L169: `"Have a listen first. Then tell me who should be able to hear it."`

**app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx** (Client)
- L15-17: TIERS labels/descs (same as AnswerFlow) → common.audienceTiers
- L101: `"Thank you. Your family will hear it now."`; L120: `"Let's pick this up another time. The person who invited you will check in soon."`; L144: `"One moment…"`; L174: `Say it in your own words — "Yes, my family can hear this."`; L179 label `"Listening…"`; L184: `"I'm finished"`; L208: `"Who should hear this?"`; L273 `${opt.label}` / L282 `${opt.desc}` (TIERS → common.audienceTiers); L306 label `"Approve aloud"`

### JOIN

**app/join/[token]/page.tsx** (Server)
- L65: `"That email already has an account. Sign in first, then open this link again."`; L66: `"Please fill in your name, email, and a password."`; L67: `"We couldn't complete the invite — it may have just been used or expired."`; L125: `"This invite is no longer valid"`; L136: `"It may have already been used, or it expired. Ask whoever invited you to send a fresh link — or sign in if you already have an account."`; L140 label `"Sign in"`; L190: `"FROM THE INVITE"`; L199: `"A new relative"`; L207 eyebrow `"An invitation"`; L218: `${invite.inviterName} invited you to the ${invite.familyName} family.` DYNAMIC; L229: `"Confirm who you are and come on in."`; L248: `"Something went wrong. Please try again."`; L254: `"Your relationship (edit if it's not quite right)"`; L260 placeholder `"e.g. Rosa's father"`; L275 label `"Come in"`; L291: `"Your name"`; L302: `"Email"`; L309 placeholder `"you@example.com"`; L313: `"Create a password"`; L320 placeholder `"Choose a password"`; L323 label `"Create login & come in"`

### AUTH

**app/sign-in/page.tsx**
- L39 title `"Welcome back"`; L40 subtitle `"Sign in to see your family's stories."`; L41 error `"That email and password don't match. Please try again."`; L51 `"New here?"`; L53 `"Create your family"`; L60 `"Email"`; L67 placeholder `"you@example.com"`; L71 `"Password"`; L78 placeholder `"Your password"`; L81 label `"Sign in"` — STATIC — Server

**app/sign-up/page.tsx**
- L35: `"That email already has an account. Try signing in instead."`; L36: `"Please fill in your name, email, and a password."`; L47 title `"Create your family"`; L48 subtitle `"Start a space for your family's stories. You can invite relatives and narrators once you're in."`; L59 `"Already have an account?"`; L61 `"Sign in"`; L68 `"Your name"`; L75 placeholder `"Sofia Boudreaux"`; L79 `"Email"`; L86 placeholder `"you@example.com"`; L90 `"Password"`; L97 placeholder `"Choose a password"`; L100 label `"Create account"` — STATIC — Server

**app/dev/sign-in/page.tsx**
- L55: `"dev · localhost"`; L56: `"Dev sign-in"`; L58: `"Local development only. One click to act as any seeded user — sets the mock session and takes you straight to the hub."`; L74: `Become ${p.displayName}` DYNAMIC; L81 label `"Sign out"`; L88: `"‹ Back to hub"` — Server

**app/page.tsx**
- L28 eyebrow `"Est. 2026"`; L39: `"Family Chronicle"` (→ common.appName, done in Task 1); L51: `"A warm place to gather your family's stories — and to help the people you love tell theirs before they're lost."`; L65 label `"Create your family"`; L68 label `"Sign in"`; L81: `"Invited a narrator to record? They open their own personal link — they never sign in here."` — STATIC — Server

## Appendix B — Numeric Constant Inventory (authoritative)

> 27 constants across 5 packages. Each: file:line, current code, value, proposed name, description, usage sites. See planning inventory.

### apps/web/lib

| Current | Value | Type | Proposed name | Controls | Usage |
|---|---|---|---|---|---|
| `auth-mock.ts:41` `const SCRYPT_KEYLEN = 64` | 64 | named | `SCRYPT_KEY_LENGTH_BYTES` | scrypt derived-key length | auth-mock.ts:50 |
| `auth-mock.ts:49` `randomBytes(16)` | 16 | anon | `PASSWORD_SALT_BYTES` | password salt size | auth-mock.ts:49 |
| `_kindred/font-scale-constants.ts:9` `FONT_SIZE_STEPS_PT = [8,10,12,14,18]` | array | named | keep name `FONT_SIZE_STEPS_PT` | root font sizes (pt) per picker step | KindredFontScale.tsx, layout.tsx pre-paint script |
| `_kindred/font-scale-constants.ts:12` `DEFAULT_FONT_SIZE_INDEX = 1` | 1 | named | keep name `DEFAULT_FONT_SIZE_INDEX` | default size step before narrator chooses | KindredFontScale.tsx, layout.tsx |

> **EXCLUDED:** `font-scale-constants.ts:15` `FONT_SIZE_STORAGE_KEY = "kin-font-size"` — a localStorage key (internal structural identifier, not a domain knob). Do **not** move it into `lib/constants.ts`. See Task 9.

### packages/capture/src

| Current | Value | Type | Proposed name | Controls | Usage |
|---|---|---|---|---|---|
| `sessions.ts:14` `DEFAULT_TTL_DAYS = 30` | 30 | named | `LINK_SESSION_DEFAULT_TTL_DAYS` | default link-session TTL (days) | sessions.ts:47 |
| `sessions.ts:15` `MS_PER_DAY = 86_400_000` | 86_400_000 | named | `MILLISECONDS_PER_DAY` | ms-per-day conversion | sessions.ts:48 |
| `sessions.ts:44` `randomBytes(32)` | 32 | anon | `LINK_SESSION_TOKEN_ENTROPY_BYTES` | link-session token entropy (256 bits) | sessions.ts:44 |

### packages/core/src

| Current | Value | Type | Proposed name | Controls | Usage |
|---|---|---|---|---|---|
| `asks.ts:218` `opts.limit ?? 20` | 20 | anon | `PENDING_ASKS_DEFAULT_LIMIT` | default pending-asks page size | asks.ts:218, :233 |
| `family-search.ts:55` `WEIGHT_NAME = 4` | 4 | named | `FAMILY_SEARCH_WEIGHT_NAME` | name-match score weight | family-search.ts:122 |
| `family-search.ts:56` `WEIGHT_STEWARD = 3` | 3 | named | `FAMILY_SEARCH_WEIGHT_STEWARD` | steward-match weight | family-search.ts:123 |
| `family-search.ts:57` `WEIGHT_DESCRIPTION = 2` | 2 | named | `FAMILY_SEARCH_WEIGHT_DESCRIPTION` | description-match weight | family-search.ts:124 |
| `family-search.ts:58` `WEIGHT_MEMBER = 1` | 1 | named | `FAMILY_SEARCH_WEIGHT_MEMBER` | member-match weight | family-search.ts:125 |
| `family-search.ts:68` `query.limit ?? 10` | 10 | anon | `FAMILY_SEARCH_DEFAULT_LIMIT` | default search result count | family-search.ts:68, :154 |
| `invitations.ts:16` `DEFAULT_TTL_MS = 14 * 86_400_000` | 1_209_600_000 | named | `MEMBER_INVITATION_DEFAULT_TTL_MS` | invitation TTL (14 days, ms) | invitations.ts:49 |
| `invitations.ts:48` `randomBytes(32)` | 32 | anon | `MEMBER_INVITATION_TOKEN_ENTROPY_BYTES` | invitation token entropy (256 bits) | invitations.ts:48 |

### packages/pipeline/src

| Current | Value | Type | Proposed name | Controls | Usage |
|---|---|---|---|---|---|
| `render-story.ts:80` `temperature: 0.2` | 0.2 | anon | `STORY_RENDER_LLM_TEMPERATURE` | render LLM temperature | render-story.ts:80 |
| `render-story.ts:81` `maxOutputTokens: 4000` | 4000 | anon | `STORY_RENDER_MAX_OUTPUT_TOKENS` | render output token cap | render-story.ts:81 |
| `render-story.ts:101` `slice(0, 200)` | 200 | anon | `STORY_TITLE_MAX_CHARS` | parsed title char cap | render-story.ts:101 |
| `render-story.ts:105` `slice(0, 400)` | 400 | anon | `STORY_SUMMARY_MAX_CHARS` | parsed summary char cap | render-story.ts:105 |
| `render-story.ts:110` `slice(0, 8)` | 8 | anon | `STORY_TAGS_MAX_COUNT` | max tags per story | render-story.ts:110 |
| `render-story.ts:102` `firstLineFallback(...,80)` | 80 | anon | `STORY_TITLE_FALLBACK_MAX_CHARS` | fallback title char cap | render-story.ts:102, :145-147 |
| `render-story.ts:106` `firstLineFallback(...,200)` | 200 | anon | `STORY_SUMMARY_FALLBACK_MAX_CHARS` | fallback summary char cap | render-story.ts:106, :145-147 |
| `job-queue.ts:27` `MAX_ATTEMPTS_PER_JOB_ID = 8` | 8 | named | `PIPELINE_JOB_MAX_ATTEMPTS` | per-job retry cap | job-queue.ts:72 |
| `orchestrator.ts:105` `speedFactor < 1.0` | 1.0 | anon | `AUDIO_SPEED_FACTOR_MIN` | min time-stretch factor | orchestrator.ts:105-109 |
| `orchestrator.ts:105` `speedFactor > 2.0` | 2.0 | anon | `AUDIO_SPEED_FACTOR_MAX` | max time-stretch factor | orchestrator.ts:105-109 |

### packages/interviewer/src

| Current | Value | Type | Proposed name | Controls | Usage |
|---|---|---|---|---|---|
| `behavior.ts:46` `export RAPPORT_THRESHOLD_TURNS = 4` | 4 | named (public) | keep `RAPPORT_THRESHOLD_TURNS` | turns before sensitive Qs | behavior.ts:277, turn-loop.ts, index.ts:30 |
| `behavior.ts:52` `export SILENCE_TOLERANCE_MS = 12_000` | 12_000 | named (public) | keep `SILENCE_TOLERANCE_MS` | silence before nudge (ms) | turn-loop.ts:23, index.ts:31 |
| `behavior.ts:58` `export MEMORY_LOOKBACK_COUNT = 8` | 8 | named (public) | keep `MEMORY_LOOKBACK_COUNT` | prior stories for memory/dedup | turn-loop.ts:23,82, index.ts:32 |
| `phraser.ts:61` `temperature: 0.4` | 0.4 | anon | `INTERVIEWER_PHRASE_LLM_TEMPERATURE` | phrasing LLM temperature | phraser.ts:61 |
| `phraser.ts:62` `maxOutputTokens: 250` | 250 | anon | `INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS` | phrasing output token cap | phraser.ts:62 |

> **Note on mocks:** the numeric inventory deliberately excludes `mocks.ts` factors (e.g. `wordCount * 400`) and `working-copy.ts`'s `* 1000` seconds→ms conversion — these are mock-internal / unit conversions, not tunable domain knobs (consistent with the spec's "don't centralize fixtures" rule).
<!-- APPENDIX_B_END -->
