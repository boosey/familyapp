# Intake Surface + Wiring — Finishing the New-User Interview Slice

> Follow-up to `2026-06-29-new-user-interview-process.md` (Plan A). That plan built the intake
> *machinery* (typed `BiographicalProfile`, intake bank, per-turn extraction, post-approval
> extraction, hub reminder) but left it **unconsumed**: nothing in `apps/web` imports
> `@chronicle/interviewer`, the hub reminder links nowhere, the post-approval augmentation is
> unwired, and the old `/welcome` interview still writes stale anchor keys. This plan connects
> the wires and retires the stale path.

**Goal:** Close the four loose ends from the prior session's partial report:
1. Give the hub `IntakeReminder` a real destination (`/hub/about-you`).
2. Wire `augmentProfileFromStory` into the post-approval path.
3. Retire the stale `recordInterviewAnchors` intake (dead `birthplace`/`placesLived`/`keyMoments` keys).
4. Plan B (text stories) — confirm still deferred; no work.

**Execution method:** Per `CLAUDE.md` §Workflow — subagent-driven. A coding sub-agent writes each
task; a *fresh cold* adversarial reviewer sub-agent reviews; iterate to clean before the next task.
Per global prefs: companion regression test after each fix; shared contracts (the `Runtime`
`languageModel` field) land FIRST as a blocking step before parallel work.

---

## Decisions captured during grilling (do not re-litigate)

- **`/record` is a thin intake flow, NOT a turn-loop integration.** It reuses the *built* intake
  primitives (`INTAKE_QUESTIONS`, `nextIntakeQuestion`, `extractIntakeAnswer`,
  `createCoreAnchorSource(db).writeProfileField`). It does **not** drive `createInterviewSession`,
  synthesize voice, or run the LLM phraser. Full turn-loop-in-web (voice, phrasing, warm callbacks,
  deeplink asks, session-state-across-HTTP) is **deferred**, in the same spirit as Plan B.
- **Canonical term = "intake"** (matches all existing code: `INTAKE_QUESTIONS`, `IntakeReminder`,
  the `intake` `PromptIntent`, `askedIntakeKeys`). **User-facing copy = "your introduction"**
  (warm; matches the reminder banner). CONTEXT.md already enshrines "Intake" correctly — no glossary
  edit needed; the stale code is what contradicts it.
- **Route = `/hub/about-you`** (account-authed, beside `/hub/answer`, `/hub/ask`).
- **Structured 6-question walk, one at a time — NOT a freeform "tell me about yourself."** A blank
  box is the paralysis the interviewer exists to replace. Each question is open in *tone* but targets
  *one* `BiographicalProfile` field. Progress shown; exit anytime; each answer saved as it's given.
- **Question text rendered verbatim** (already written warm). No per-question LLM phrasing.
- **Textarea input; voice button stubbed** — identical to `/welcome` (no mic in this environment).
- **`/welcome` door 2 routes to `/hub/about-you`.** The inline interview step + `welcome.questions`
  + `saveInterviewFacts` + `buildFacts`/`commitDraft` + the `done` step are deleted. ONE intake
  surface, reached from both onboarding and the hub reminder.
- **Item 2 wired in `shareAnswerAction`, best-effort, AFTER `approveAndShareStory`.** Re-read the
  story via `getStoryForViewer` (returns the full row incl. `transcript`), then call
  `augmentProfileFromStory(transcript, ownerPersonId, languageModel, createCoreAnchorSource(db))`.
  Wrapped in try/catch so a failed inference never breaks the user's Share or adds redirect latency.
- **Dev-without-key degradation is accepted, not worked around.** Extraction needs a `LanguageModel`;
  with no `ANTHROPIC_API_KEY` the runtime uses a bare `ScriptedLanguageModel`, so intake fields won't
  populate in dev. This mirrors the existing no-`GROQ_API_KEY` → placeholder-transcript behavior and
  the turn loop's own tests (which script the mock). We do NOT add a verbatim-write fallback — that
  would re-create the parallel-path sin of item 3.
- **No architecture-allowlist changes.** `persons` is the open schema (intake writes are non-content);
  `createCoreAnchorSource` uses raw `db.execute(sql)` on `persons` (documented bypass). The transcript
  re-read uses the front door (`getStoryForViewer`), not the guarded `@chronicle/core/pipeline`.

---

## Task 0 — Shared contract FIRST (blocking): expose `languageModel` on `Runtime`

Both the intake flow (Task 1) and item 2 (Task 3) need a bare `LanguageModel`. The runtime builds
one (`runtime.ts:128`) but only exposes `newPipeline`. Add it to the `Runtime` type + return value.

**File:** `apps/web/lib/runtime.ts`
- Add `languageModel: LanguageModel;` to the `Runtime` type (import the `LanguageModel` type from
  `@chronicle/pipeline`).
- Return `languageModel` from `build()` (it already exists as a local).

**Gate:** `pnpm --filter @chronicle/web typecheck` clean.

---

## Task 1 — Items 1 + 3: the `/hub/about-you` intake surface + retire the stale path

### 1a. New route `apps/web/app/hub/about-you/`

**`page.tsx` (server component):**
- Resolve auth (`getRuntime`, `getCurrentAuthContext`); redirect to sign-in if not `account`.
- Load the profile: `createCoreAnchorSource(db).loadForNarrator(personId)` → `anchors.profile`
  (a full `BiographicalProfile` with nulls), or read `persons.biographicalAnchors` directly.
- Compute `nextIntakeQuestion(profile, new Set())` for the initial question.
- If already complete (`null`), redirect to `/hub` (nothing to ask).
- Render `<AboutYouFlow firstName initialQuestion={{key,text}} hubHref="/hub" />`. Pass only plain
  data — the client must NOT import `@chronicle/interviewer` (its index transitively pulls
  `core-adapters` → `db`, which can't be in a client bundle).

**`actions.ts` (`"use server"`):**
```ts
// submitIntakeAnswer: extract one field, write it, return the NEXT question (computed server-side).
export async function submitIntakeAnswer(
  askedKeys: string[],
  key: keyof BiographicalProfile,
  answer: string,
): Promise<{ nextQuestion: { key: string; text: string } | null }> {
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const question = INTAKE_QUESTIONS.find((q) => q.key === key);
  if (question) {
    try {
      const value = await extractIntakeAnswer(languageModel, question, answer);
      if (value !== null && value !== undefined) {
        await createCoreAnchorSource(db).writeProfileField(ctx.personId, key, value as never);
      }
    } catch { /* best-effort: field stays null, question re-askable next session */ }
  }

  // Recompute from fresh DB truth + the keys the client has already shown this session.
  const fresh = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  const asked = new Set<keyof BiographicalProfile>([...askedKeys, key] as never);
  const next = fresh ? nextIntakeQuestion(fresh.profile, asked) : null;
  return { nextQuestion: next ? { key: next.key, text: next.text } : null };
}
```
This keeps `@chronicle/interviewer` entirely server-side and solves the "skip a question whose
extraction returned null" problem by threading `askedKeys` from the client (the turn loop's
`askedIntakeKeys`, made stateless across HTTP).

**`AboutYouFlow.tsx` (`"use client"`):** model on `WelcomeFlow`'s interview step.
- State: `current: {key,text} | null`, `askedKeys: string[]`, `draft`, `busy`, `error`.
- Render: progress hint, the question `text` (verbatim), stubbed `KindredVoiceButton`, a textarea,
  Next + "Take me to the hub →" exit.
- On Next: `await submitIntakeAnswer(askedKeys, current.key, draft)`; push `current.key` into
  `askedKeys`; set `current = result.nextQuestion`; clear `draft`. When `nextQuestion === null`,
  show a brief thank-you then `router.push(hubHref)`.
- Exit saves the current draft first (best-effort), then navigates — same pattern as `WelcomeFlow.exitToHub`.

**Copy:** add an `aboutYou` block to `_copy/` (or extend `_copy/hub.ts`) — "your introduction"
framing, progress label, thank-you. Reuse `hub.intake.*` where it fits.

### 1b. Point the hub reminder at it

**File:** `apps/web/app/hub/IntakeReminder.tsx` — restore a CTA: a `next/link` to `/hub/about-you`
("Continue your introduction"). Keep the `isProfileComplete` gate (unchanged). The banner is no
longer merely informational.

### 1c. Retire the stale path (item 3)

- **`packages/core/src/onboarding.ts`** — delete `recordInterviewAnchors`, `InterviewAnchors`,
  and the `birthplace/placesLived/keyMoments` merge. Keep `completeOnboarding` (DOB) untouched.
- **`packages/core/src/index.ts`** — drop the `recordInterviewAnchors` / `InterviewAnchors` exports.
- **`packages/core/test/onboarding.test.ts`** — delete the `recordInterviewAnchors` describe block;
  keep the `completeOnboarding` tests.
- **`apps/web/app/welcome/actions.ts`** — delete `saveInterviewFacts` + `InterviewFacts`.
- **`apps/web/app/welcome/WelcomeFlow.tsx`** — delete the `interview` and `done` steps,
  `qIndex`/`answers`/`draft` interview state, `buildFacts`, `commitDraft`, `nextQuestion`,
  `exitToHub`'s save call. Door 2's onClick becomes `router.push("/hub/about-you")`.
- **`apps/web/app/_copy/welcome.ts`** — delete the `questions` array + interview/done copy; reword
  door 2 ("Introduce yourself" / "A few quick questions about you" — it's ~6 quick prompts, not a
  12-minute story, so the old `tellStoryDuration`/`tellStoryBody` copy is now wrong).

### 1d. Tests (regression per global prefs)

- **`packages/core/test/onboarding.test.ts`** — assert (compile-time via removed import is enough,
  but add) that `completeOnboarding` still works; the stale-path tests are gone.
- **New `@chronicle/interviewer` test** (or extend `interviewer.test.ts`): integration over PGlite —
  `createCoreAnchorSource(db).writeProfileField(p, "hometown", "New Orleans")` then
  `loadForNarrator` returns `profile.hometown === "New Orleans"` and other fields null. (May already
  exist from Plan A Task 8 — if so, no new test.)
- **Web action test** for `submitIntakeAnswer` if the repo tests server actions; otherwise cover the
  composed behavior via a small unit test of the extract→write→nextQuestion sequence with a scripted
  LLM. At minimum: a test asserting a scripted-LLM answer to the `hometown` question results in
  `profile.hometown` populated and `nextQuestion.key === "siblingContext"`.

---

## Task 2 — (intentionally folded into Task 1) — none

Items 1 and 3 are one slice; there is no separate Task 2.

---

## Task 3 — Item 2: wire `augmentProfileFromStory` into the share path

**File:** `apps/web/app/hub/answer/[askId]/actions.ts` — `shareAnswerAction`.

After `approveAndShareStory(...)` succeeds (still inside the function, but in its own try/catch so it
can never fail the Share or delay the `redirect("/hub")`):

```ts
import { augmentProfileFromStory } from "@chronicle/pipeline";
import { createCoreAnchorSource } from "@chronicle/interviewer";
// ...languageModel now available from getRuntime()...

try {
  const approved = await getStoryForViewer(db, ctx, storyId); // full row incl. transcript
  if (approved?.transcript) {
    await augmentProfileFromStory(
      approved.transcript,
      ctx.personId,
      languageModel,
      createCoreAnchorSource(db), // structurally satisfies BiographicalProfileStore
    );
  }
} catch {
  // Augmentation is a nice-to-have; never block the share or the redirect.
}
```

Notes:
- `augmentProfileFromStory` (already built, `packages/pipeline/src/extract-biography.ts`) only writes
  fields currently null — it **never overwrites a direct intake answer**. No new no-overwrite logic.
- `createCoreAnchorSource` returns an `AnchorSource` (`loadForNarrator` + `writeProfileField`), which
  structurally satisfies the `BiographicalProfileStore` parameter — confirm at typecheck.
- Re-read AFTER the pipeline (the existing `getStoryForViewer` call at the top runs before transcribe,
  so its `transcript` is null — do a fresh read here).
- `apps/web` is the composition root; importing both `@chronicle/pipeline` and `@chronicle/interviewer`
  is fine (no package cycle, no SDK-scan tree).

**Tests (regression):** `extractBiographicalProfile` / `augmentProfileFromStory` are already covered
in `packages/pipeline/test/extract-biography.test.ts`. Add (if not present) a PGlite integration test
of `augmentProfileFromStory` + `createCoreAnchorSource`: pre-populate `hometown` directly, run with a
scripted LLM returning `{hometown:"X", occupationSummary:"Y"}`, assert `hometown` unchanged and
`occupationSummary` written.

---

## Task 4 — Item 4: Plan B (text stories) — confirm deferred

No work. Re-state in the plan: text *stories* (discriminated `stories.kind`, nullable
`recording_media_id`, the `chronicle_story_recording_pointer_immutable` trigger revisit, a core text
write path) remain a separate vertical slice. Intake's keyboard input is unrelated — intake is
ephemeral and writes only `biographical_anchors`, never a Story.

---

## Final verification

- `pnpm -r typecheck` → PASS
- `pnpm -r test` → PASS (incl. removed stale-path tests, new intake/augmentation tests)
- `pnpm -r lint` → PASS
- `pnpm --filter @chronicle/web build` → PASS
- `packages/core/test/architecture.test.ts` + `packages/pipeline/test/pipeline.test.ts` canaries
  unchanged — confirm no new content-table or vendor-SDK import slipped in. (Expected: none.)
- Manual (dev, with `ANTHROPIC_API_KEY` set so extraction is real):
  - `/welcome` → DOB → door 2 lands on `/hub/about-you`; answering walks hometown→…→done→`/hub`.
  - `/hub` reminder shows until profile complete; its CTA reaches `/hub/about-you`; hides when complete.
  - Answer+Share a story whose transcript mentions an unpopulated field → that field appears in the
    profile afterward; a directly-answered field is NOT overwritten.

---

## Self-review

- **Items covered:** 1 (CTA → `/hub/about-you`), 2 (augmentation wired in `shareAnswerAction`),
  3 (stale path deleted end-to-end), 4 (confirmed deferred).
- **No new parallel intake path:** `/hub/about-you` and `/welcome` door 2 both funnel to the single
  `/hub/about-you` surface, which uses the one built bank + extractor. The stale keys are gone.
- **Front door intact:** transcript re-read goes through `getStoryForViewer`; intake writes hit the
  open `persons` schema. No allowlist change.
- **Honest degradation:** dev-without-key intake doesn't populate — documented, consistent with the
  existing pipeline mock behavior, not papered over.
