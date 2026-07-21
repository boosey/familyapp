# Centralize UI Copy + Domain Numeric Constants — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorming) — pending implementation plan

## Goal

Two related but distinct outcomes:

1. **i18n on-ramp.** Pull user-facing display copy out of `apps/web` JSX into namespaced
   TypeScript message modules, structured so a later migration to a real i18n library
   (e.g. next-intl) is mechanical rather than a rewrite.
2. **One-place management of domain numbers.** Collect domain/business numeric constants
   into a single `constants.ts` per package so they can be found and tuned without hunting
   through implementation files.

This is a **behavior-preserving refactor**: rendered text and runtime values are identical
before and after. No new features.

## Non-goals (explicitly out of scope)

- **Internal / structural strings** stay as literals: route paths (`/hub?tab=asks`),
  discriminant values (`ctx.kind`, `status === "active"`), CSS var strings
  (`"var(--font-ui)"`), `className` values, DOM attribute names (`name="targetPersonId"`).
- **Domain error messages** thrown in `@chronicle/core` (e.g. `"must be signed in"`). A
  codes-based scheme is a separate future effort; not touched here.
- **Interviewer behavioral copy** (`@chronicle/interviewer` phraser / question bank /
  behavior). The question bank is already data; the phraser is templated generation. Out of
  scope.
- **Layout / styling magic numbers** (`maxWidth: 600`, `rows={5}`, `gap: 20`, margins).
  These are design values and belong in the existing `--kin-*` / `--font-*` / `--text-*`
  CSS token system, not a TS constants file.
- **`apps/web/lib/dev-seed.ts` fixtures** (`birthYear: 1942`, `sampleRate: 8000`, era
  years, sample transcripts/prose). These are sample data, not constants.
- **HTTP status codes, SQLSTATE codes** (`"23505"`), checksum/byte literals that are part of
  an algorithm's correctness rather than a tunable knob — left in place.

## Part A — UI copy (`apps/web`)

### Structure

New directory `apps/web/app/_copy/`, namespaced **by route group**, mirroring how
`app/_kindred/` is organized:

```
app/_copy/
  index.ts        # barrel: re-export all namespaces
  common.ts       # shared copy: "Sign in to …", account menu, generic button labels
  hub.ts          # hub shell + all tabs (ask, asks, questions, requests, stories, invite)
                  #   + answer flow + stories detail
  families.ts     # families/find, families/new, families/start
  welcome.ts      # welcome flow
  capture.ts      # s/[token] narrator recorder + approve/[storyId] approval recorder
  join.ts         # join/[token]
  auth.ts         # sign-in, sign-up, _auth/AuthScreen
```

### Shape

Each module exports one `as const` nested object, keyed `section/component → field`:

```ts
// app/_copy/hub.ts
export const hub = {
  ask: {
    heading: "Ask a question",
    intro:
      "Your question goes into the queue. It will be asked next time they sit down to " +
      "talk — never as an interruption.",
    promptEyebrow: "What would you love to hear?",
    promptQuestion: "A good ask is small and human — a name, a smell, a feeling, a Sunday.",
    forLabel: "For",
    questionLabel: "Your question",
    questionPlaceholder: "e.g. What was your mother singing on Sunday mornings?",
    submit: "Send to the queue",
    signedOut: "Sign in to ask a question.",
  },
  // …
} as const;
```

- **Static strings** → string literals.
- **Dynamic strings** → arrow functions whose parameters are the interpolated values:
  `flash: (name: string) => \`Invite sent to ${name}\``. The function-arg boundary is the
  thing that makes a future next-intl move mechanical (args ≈ ICU placeholders).
- Plain ESM imports — zero runtime, works identically in server and client components.

### What counts as "copy" (in scope)

Visible text nodes, headings, `placeholder`, `aria-label`, button/link labels, empty-state
text, toast/flash messages.

### Consumption

```ts
import { hub } from "@/app/_copy";
// <h2>{hub.ask.heading}</h2>
// <textarea placeholder={hub.ask.questionPlaceholder} />
```

## Part B — Domain numeric constants

### Structure

A `constants.ts` per package that holds domain numbers. **All** domain numeric constants
move here, including ones currently named and co-located (per explicit decision: prioritize
one-place management over co-location):

```
apps/web/lib/constants.ts
packages/capture/src/constants.ts
packages/core/src/constants.ts
packages/pipeline/src/constants.ts
packages/interviewer/src/constants.ts
```

Each names previously-anonymous magic numbers and re-homes already-named consts.

### Known constants to relocate / name (non-exhaustive; plan phase will do a full sweep)

- `packages/capture/src/sessions.ts`: `MS_PER_DAY` (already named); token entropy
  `randomBytes(32)` → `SESSION_TOKEN_BYTES = 32`.
- `packages/core/src/invitations.ts`: `DEFAULT_TTL_MS` (already named); `randomBytes(32)` →
  `INVITE_TOKEN_BYTES`.
- `packages/interviewer/src/behavior.ts`: `SILENCE_TOLERANCE_MS` (already named).
- `packages/interviewer/src/phraser.ts`: `maxOutputTokens: 250` → `PHRASER_MAX_OUTPUT_TOKENS`.
- `packages/interviewer/src/mocks.ts`: `wordCount * 400` → words-per-ms style const (mock;
  include for consistency).
- `packages/pipeline/src/render-story.ts`: `maxOutputTokens: 4000` →
  `RENDER_MAX_OUTPUT_TOKENS`; `200`/`400` slice caps → `STORY_TITLE_MAX_CHARS` /
  `STORY_SUMMARY_MAX_CHARS`.
- `packages/pipeline/src/mocks.ts`: `slice(0, 140)` → summary-cap const.
- `packages/pipeline/src/working-copy.ts`: `* 1000` seconds→ms (evaluate; may be a unit
  conversion better left inline as `MS_PER_SECOND`).

The plan phase produces the authoritative list via a full numeric-literal sweep of the five
locations, applying the non-goals filter above.

### Naming convention

`SCREAMING_SNAKE_CASE`, descriptive, unit-suffixed where it removes ambiguity
(`_MS`, `_BYTES`, `_CHARS`, `_TOKENS`). Each const gets a one-line comment if its purpose
isn't obvious from the name.

## Risks / things to verify

- **Architecture tests.** `packages/core/test/architecture.test.ts` and
  `packages/pipeline/test/pipeline.test.ts` scan source imports. Relocating consts adds
  intra-package imports (`./constants`) but introduces no `@chronicle/db/content`,
  `@chronicle/db/client`, or vendor-SDK imports — must stay green.
- **`verbatimModuleSyntax` / ESM.** New modules use explicit `.ts`-less ESM imports
  consistent with the repo; `as const` objects export fine.
- **Behavior preservation.** Extracted copy must render byte-identical; relocated numbers
  must be the same values. Risk of a typo during mechanical move — caught by typecheck +
  existing tests + targeted spot-checks.

## Verification plan

- `pnpm -r typecheck` green.
- `pnpm -r test` green (covers the architecture/invariant tests and unit behavior).
- `pnpm -r lint` green.
- Manual spot-check of 2–3 representative web routes (hub ask tab, welcome, capture) to
  confirm rendered copy is unchanged.

## Migration note (future, not this pass)

Because copy is keyed and dynamic values are already function-parameterized, a later
next-intl adoption is: (1) serialize the `_copy/*` objects to `messages/en.json`, (2) swap
imports for `useTranslations`/`getTranslations`, (3) convert arrow-fn args to ICU
placeholders. No re-identification of strings needed.
