# Honor stream prefs on story-shared pings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After authorize-read + email resolution, assign each story-shared ping candidate an owning stream and drop recipients whose frequency is `off`, with no fall-through.

**Architecture:** Extend `listStorySharedPingRecipients` in `@chronicle/core` only. After building each recipient’s `kind`, map asker → `answers_to_my_asks`, else → `family_activity`; call `getNotificationStreamFrequency`; omit when frequency is `off`. Delivery stays “send the list” — no call-site, dispatch, or invite changes. Digest frequencies (`daily_digest` / `weekly_digest`) are **not** filtered here (#277); only `off` suppresses immediate email.

**Tech Stack:** TypeScript, Vitest, PGlite, `@chronicle/core` prefs API from #278 (`getNotificationStreamFrequency` / `setNotificationStreamFrequency`).

**Issue:** [#279](https://github.com/boosey/familyapp/issues/279) (parent decisions: closed #272 / `.scratch/issue-272-spec.md`).

---

## File structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/story-shared-pings.ts` | After kind assignment, resolve owning stream + drop `off` |
| `packages/core/test/story-shared-pings.test.ts` | Prefs honor behavior (AC cases) |
| `apps/web/__tests__/deliver-story-shared-pings.test.ts` | Optional MockNotifier proof that filtered list is what sends |

Do **not** modify: approve/share call sites, `dispatchStorySharedNotify`, invite delivery, prefs schema, hub settings (#280).

---

### Task 1: Failing tests — prefs honor on recipient resolution

**Files:**
- Modify: `packages/core/test/story-shared-pings.test.ts`
- Modify (light): `apps/web/__tests__/deliver-story-shared-pings.test.ts`

- [ ] **Step 1: Add imports for prefs helpers**

In `packages/core/test/story-shared-pings.test.ts`, extend the existing import from `../src/index` to include `setNotificationStreamFrequency`:

```ts
import {
  approveAndShareStory,
  createAsk,
  listStorySharedPingRecipients,
  persistRecordingAndCreateDraft,
  setNotificationStreamFrequency,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
```

- [ ] **Step 2: Write failing core tests**

Append these cases inside the existing `describe("listStorySharedPingRecipients", ...)` block. Reuse the ask-backed share setup from the existing “tags the asker…” test (createAsk → persistRecordingAndCreateDraft with askId → updateDerivedFields → transition → approveAndShareStory). Prefer a small local helper if it reduces duplication, but do not refactor unrelated tests.

```ts
  it("omits asker when answers_to_my_asks is off (no fall-through to family_activity)", async () => {
    const owner = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const other = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, other.id, fam.id);
    await attachVerifiedEmail(asker.id, "sofia@example.com");
    await attachVerifiedEmail(other.id, "marcus@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: owner.id, questionText: "Tell me about Sunday dinner." },
    );
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: owner.id,
        storageKey: "r2://r.webm",
        contentType: "audio/webm",
        checksum: "sha256:r",
      },
      { askId: ask.id },
    );
    await updateDerivedFields(db, story.id, {
      transcript: "t",
      prose: "p",
      title: "Sunday",
      summary: "s",
      tags: [],
    });
    await transitionStoryState(db, story.id, "pending_approval");
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: owner.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });

    await setNotificationStreamFrequency(
      db,
      asker.id,
      "answers_to_my_asks",
      "off",
    );
    // Family activity stays every_item (default) — asker must still be omitted.
    await setNotificationStreamFrequency(
      db,
      other.id,
      "family_activity",
      "every_item",
    );

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients.map((r) => r.personId)).toEqual([other.id]);
    expect(result.recipients.find((r) => r.personId === asker.id)).toBeUndefined();
  });

  it("omits non-asker when family_activity is off; keeps every_item co-members", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const marcus = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "Boudreaux", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await addMembership(db, marcus.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");
    await attachVerifiedEmail(marcus.id, "marcus@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    await setNotificationStreamFrequency(db, sofia.id, "family_activity", "off");
    // marcus: no prefs row → every_item

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      {
        personId: marcus.id,
        email: "marcus@example.com",
        kind: "family",
      },
    ]);
  });

  it("preserves pre-prefs audience when no prefs rows exist", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      {
        personId: sofia.id,
        email: "sofia@example.com",
        kind: "family",
      },
    ]);
    expect(result.recipients.every((r) => r.personId !== owner.id)).toBe(true);
  });
```

- [ ] **Step 3: Add one MockNotifier delivery test**

In `apps/web/__tests__/deliver-story-shared-pings.test.ts`, import `setNotificationStreamFrequency` from `@chronicle/core` and add:

```ts
  it("does not send to recipients whose owning stream is off", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const marcus = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await addMembership(db, marcus.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");
    await attachVerifiedEmail(marcus.id, "marcus@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    await setNotificationStreamFrequency(db, sofia.id, "family_activity", "off");

    const notifier = new MockNotifier();
    await deliverStorySharedPings({
      db,
      notifier,
      storyId: story.id,
      origin: "https://app.test",
    });

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.to).toBe("marcus@example.com");
  });
```

- [ ] **Step 4: Run tests — expect FAIL on prefs cases**

```bash
pnpm --filter @chronicle/core exec vitest run test/story-shared-pings.test.ts
pnpm --filter @chronicle/web exec vitest run __tests__/deliver-story-shared-pings.test.ts
```

Expected: new prefs tests FAIL (asker/family with `off` still included). Pre-existing tests still PASS.

- [ ] **Step 5: Commit failing tests**

```bash
git add packages/core/test/story-shared-pings.test.ts apps/web/__tests__/deliver-story-shared-pings.test.ts
git commit -m "$(cat <<'EOF'
test: story-shared pings honor stream prefs off (#279)

EOF
)"
```

---

### Task 2: Filter `off` in `listStorySharedPingRecipients`

**Files:**
- Modify: `packages/core/src/story-shared-pings.ts`

- [ ] **Step 1: Import prefs getter**

At top of `story-shared-pings.ts`, add:

```ts
import { getNotificationStreamFrequency } from "./notification-prefs";
```

- [ ] **Step 2: Filter after kind assignment**

Replace the recipient-building loop (currently pushes every emailable authorized person) with:

```ts
  const emailsByPerson = await resolveEmails(db, authorized);
  const recipients: StorySharedPingRecipient[] = [];
  for (const personId of authorized) {
    const email = emailsByPerson.get(personId);
    if (!email) continue;
    const kind: StorySharedPingKind =
      askerPersonId !== null && personId === askerPersonId ? "asker" : "family";
    const stream =
      kind === "asker" ? "answers_to_my_asks" : "family_activity";
    const frequency = await getNotificationStreamFrequency(db, personId, stream);
    if (frequency === "off") continue;
    recipients.push({ personId, email, kind });
  }

  return { ...base, recipients };
```

Update the file-level / function doc comment to note that stream prefs are honored (`off` omits; absent → every_item via prefs API). Do not change owner exclusion, auth gating, invite paths, or call sites.

Digest note (do not implement special cases): `daily_digest` / `weekly_digest` still receive immediate email until #277.

- [ ] **Step 3: Run tests — expect PASS**

```bash
pnpm --filter @chronicle/core exec vitest run test/story-shared-pings.test.ts test/notification-prefs.test.ts
pnpm --filter @chronicle/web exec vitest run __tests__/deliver-story-shared-pings.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add packages/core/src/story-shared-pings.ts
git commit -m "$(cat <<'EOF'
feat: drop story-shared ping recipients when stream is off (#279)

EOF
)"
```

---

## Self-review (planner)

1. **Spec coverage:** Asker off / family off / no fall-through / missing→every_item / owner+auth unchanged / MockNotifier — all covered by Task 1–2. Invites untouched. Hub UI deferred to #280.
2. **Placeholders:** None.
3. **Type consistency:** Uses existing `StorySharedPingKind`, `NotificationStream` string literals matching #278 enums.

---

## Out of scope (do not do)

- Hub settings UI (#280)
- Digest assembly (#277)
- questions-for-me outbound (#276)
- Invite delivery changes
- Changing approve/share best-effort call sites
)
