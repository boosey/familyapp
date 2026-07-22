# questions-for-me outbound (ask actionable email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an Ask becomes actionable (successful `createAsk`), email the askee if their `questions_for_me` stream is not `off` and they have a reachable email — best-effort, never failing Ask creation.

**Architecture:** Mirror the story-shared ping stack (#270/#279). Core resolves whether the askee should be emailed (`resolveQuestionsForMePing`) using the same Person×stream prefs API and the same verified-email-then-accounts.email resolution as C13b. Web delivers via Notifier + copy, with durable-vs-sync dispatch (`ask.actionable.notify` job). Call sites wrap dispatch in try/catch after `createAsk` succeeds. Invites and story-shared recipient filtering are untouched. Digest cadences are not assembled (#277) — only `off` suppresses immediate send (same rule as #279).

**Tech Stack:** TypeScript, Vitest, PGlite, `@chronicle/core` prefs API (#278), `@chronicle/notifications` MockNotifier, Inngest JobQueue seam.

**Issue:** [#276](https://github.com/boosey/familyapp/issues/276) (decisions: closed #272 / `.scratch/issue-272-spec.md` / `.scratch/issue-qfm-outbound.md`).

**Locked decisions:**
- Trigger: Ask create / actionable path — **not** session-offer
- Recipient: **askee** (`asks.targetPersonId`) only; never the asker
- Skip when no reachable email (same spirit as C13b)
- Prefs: `questions_for_me`; missing → `every_item`; `off` → no send
- Deeplink: signed-in hub answer surface `/hub/answer/[askId]`
- Dispatch best-effort; Ask creation must not fail on ping errors
- Do **not** change invite delivery, story-shared filtering, or settings UI

---

## File structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/person-emails.ts` | Shared verified-email → accounts.email resolution (extracted from story-shared-pings) |
| `packages/core/src/questions-for-me-pings.ts` | Resolve askee ping context for one askId (prefs + email); null when skip |
| `packages/core/test/questions-for-me-pings.test.ts` | AC: every_item / off / default / no-email / asker never recipient |
| `packages/core/src/story-shared-pings.ts` | Use shared `resolvePersonEmails` |
| `packages/core/src/index.ts` | Export resolver + types |
| `packages/pipeline/src/contracts.ts` | Add `ask.actionable.notify` job + payload + dedupe key |
| `apps/web/app/_copy/questions-for-me-pings.ts` | Email subject/body (asker name + link; no ask prose dump required beyond short teaser optional) |
| `apps/web/app/_copy/index.ts` | Re-export |
| `apps/web/lib/deliver-questions-for-me-ping.ts` | Send one email when resolver returns a recipient |
| `apps/web/lib/dispatch-ask-actionable-notify.ts` | Inngest enqueue vs sync deliver |
| `apps/web/__tests__/deliver-questions-for-me-ping.test.ts` | MockNotifier shape + prefs honor |
| `apps/web/__tests__/dispatch-ask-actionable-notify.test.ts` | Durable vs sync |
| `apps/web/lib/runtime.ts` | Register worker; expose `dispatchAskActionableNotify` |
| `apps/web/app/hub/tabs/AskTab.tsx` | After createAsk → best-effort dispatch |
| `apps/web/app/hub/stories/[id]/actions.ts` | After follow-up createAsk → best-effort dispatch |

Do **not** modify: invite delivery, `listStorySharedPingRecipients` prefs logic (beyond email extract), hub settings (#280), digest assembly (#277).

---

### Task 1: Extract shared person-email resolution

**Files:**
- Create: `packages/core/src/person-emails.ts`
- Modify: `packages/core/src/story-shared-pings.ts`
- Test: existing `packages/core/test/story-shared-pings.test.ts` must stay green

- [ ] **Step 1: Move `resolveEmails` into `person-emails.ts` as `resolvePersonEmails`**

Export:

```ts
export async function resolvePersonEmails(
  db: Database,
  personIds: string[],
): Promise<Map<string, string>>;
```

Same behavior: prefer verified `account_contacts` email; fall back to `accounts.email`.

- [ ] **Step 2: Import it from `story-shared-pings.ts`; delete the private copy**

- [ ] **Step 3: Run** `pnpm --filter @chronicle/core exec vitest run test/story-shared-pings.test.ts` — expect PASS

- [ ] **Step 4: Commit**

```
refactor: share person email resolution for outbound pings
```

---

### Task 2: Core resolver + failing tests (TDD)

**Files:**
- Create: `packages/core/src/questions-for-me-pings.ts`
- Create: `packages/core/test/questions-for-me-pings.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Reuse PGlite helpers from `story-shared-pings.test.ts` / `asks.test.ts` (`makePerson`, `attachVerifiedEmail`, `createAsk`, `setNotificationStreamFrequency`).

Cases:
1. Askee with verified email and no prefs row → returns recipient (default every_item)
2. Askee with `questions_for_me` = `every_item` → recipient
3. Askee with `questions_for_me` = `off` → null recipient
4. Askee with no reachable email → null recipient
5. Returned recipient is always `targetPersonId`, never `askerPersonId` (when distinct)
6. Missing ask → null context / empty

Suggested API:

```ts
export interface QuestionsForMePingContext {
  askId: string;
  askeePersonId: string;
  askerDisplayName: string | null;
  questionText: string;
  /** Null when prefs off, no email, or ask missing. */
  recipient: { personId: string; email: string } | null;
}

export async function resolveQuestionsForMePing(
  db: Database,
  askId: string,
): Promise<QuestionsForMePingContext | null>;
```

Return `null` only when the ask row is missing. When ask exists but should not email, return context with `recipient: null`.

Digest frequencies (`daily_digest` / `weekly_digest`): treat like every_item for immediate send (same as #279 — only `off` suppresses). Assert optionally with one digest-frequency row still yielding a recipient.

- [ ] **Step 2: Run tests — expect FAIL**

`pnpm --filter @chronicle/core exec vitest run test/questions-for-me-pings.test.ts`

- [ ] **Step 3: Implement `questions-for-me-pings.ts`**

- Load ask by id (`asks` open schema): `targetPersonId`, `askerPersonId`, `questionText`
- Load asker display/spoken name from `persons`
- If askee === asker → `recipient: null` (never notify the asker; self-ask safety)
- `getNotificationStreamFrequency(db, askee, "questions_for_me")`; if `off` → null recipient
- Else `resolvePersonEmails(db, [askee])`; missing email → null recipient
- Else recipient `{ personId: askee, email }`

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```
feat: resolve questions-for-me askee email ping (#276)
```

---

### Task 3: Pipeline job contract

**Files:**
- Modify: `packages/pipeline/src/contracts.ts`
- Modify: any pipeline tests that exhaustively list job names / dedupe keys if present

- [ ] **Step 1: Add payload + map entry + dedupe**

```ts
export interface AskActionableNotifyJobPayload {
  askId: string;
}

// JobPayloadMap:
"ask.actionable.notify": AskActionableNotifyJobPayload;

// jobDedupeKey:
if (name === "ask.actionable.notify") {
  return `ask.actionable.notify|${(payload as AskActionableNotifyJobPayload).askId}`;
}
```

- [ ] **Step 2: Run** `pnpm --filter @chronicle/pipeline test` (or targeted contract/dedupe tests) — PASS

- [ ] **Step 3: Commit**

```
feat: add ask.actionable.notify job contract (#276)
```

---

### Task 4: Deliver + dispatch + copy (web)

**Files:**
- Create: `apps/web/app/_copy/questions-for-me-pings.ts`
- Modify: `apps/web/app/_copy/index.ts`
- Create: `apps/web/lib/deliver-questions-for-me-ping.ts`
- Create: `apps/web/lib/dispatch-ask-actionable-notify.ts`
- Create: `apps/web/__tests__/deliver-questions-for-me-ping.test.ts`
- Create: `apps/web/__tests__/dispatch-ask-actionable-notify.test.ts`

- [ ] **Step 1: Copy** — subject/body naming asker; link is `${origin}/hub/answer/${askId}`; use `common.appName`. Do not put full story prose. Question text may appear as a short line if helpful; keep it one short paragraph.

- [ ] **Step 2: `deliverQuestionsForMePing`** — call resolver; if no recipient return; else `notifier.send` email once; catch per-send errors (best-effort).

- [ ] **Step 3: `makeDispatchAskActionableNotify`** — clone `dispatch-story-shared-notify.ts` pattern with job name `ask.actionable.notify` and `{ askId }`.

- [ ] **Step 4: Tests** — MockNotifier asserts one email to askee when every_item; zero when off; dispatch enqueues when Inngest configured and does not call deliver.

- [ ] **Step 5: Commit**

```
feat: deliver and dispatch questions-for-me ask emails (#276)
```

---

### Task 5: Runtime + call-site wiring

**Files:**
- Modify: `apps/web/lib/runtime.ts`
- Modify: `apps/web/app/hub/tabs/AskTab.tsx`
- Modify: `apps/web/app/hub/stories/[id]/actions.ts`

- [ ] **Step 1: Runtime** — register Inngest worker for `ask.actionable.notify` calling `deliverQuestionsForMePing`; expose `dispatchAskActionableNotify` on Runtime (mirror story-shared).

- [ ] **Step 2: AskTab `submitAsk`** — capture returned ask from `createAsk`; after success, try/catch dispatch (non-fatal). Keep redirect after.

```ts
const ask = await createAsk(...);
try {
  await dispatchAskActionableNotify({ askId: ask.id });
} catch { /* non-fatal; optional plogError */ }
redirect("/hub?tab=asks");
```

- [ ] **Step 3: `askFollowUpAction`** — same after successful `createAsk` (use returned ask id).

- [ ] **Step 4: Do not wire `dev-seed` createAsk calls (seed is not a product outbound path).

- [ ] **Step 5: Typecheck affected packages / web if needed

- [ ] **Step 6: Commit**

```
feat: email askee when Ask becomes actionable (#276)
```

---

### Task 6: Final verification

- [ ] **Step 1: Run targeted suites**

```
pnpm --filter @chronicle/core exec vitest run test/questions-for-me-pings.test.ts test/story-shared-pings.test.ts test/notification-prefs.test.ts
pnpm --filter @chronicle/pipeline test
pnpm --filter @chronicle/web exec vitest run __tests__/deliver-questions-for-me-ping.test.ts __tests__/dispatch-ask-actionable-notify.test.ts
```

- [ ] **Step 2: `pnpm --filter @chronicle/core typecheck` and `pnpm --filter @chronicle/web typecheck`** (or repo equivalents)

- [ ] **Step 3: Confirm no invite / story-shared filtering / settings UI diffs beyond email extract**

---

## Out of scope (do not implement)

- Digest assembly (#277)
- SMS (#271)
- Asker confirmation emails
- Session-offer pings
- Changing invite delivery
- Expanding #303 / hub settings
- Magic-link credentials for this ping
