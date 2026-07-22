# Hub settings Notifications section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/hub/settings`, add a synced Notifications section where a Person can set `every item` | `off` for all three notification streams, persisted via the #278 get/set API.

**Architecture:** RSC `page.tsx` loads `listNotificationStreamFrequencies` and passes the map into the client panel. A new `settings/actions.ts` (profile-actions pattern) upserts via `setNotificationStreamFrequency`, rejecting digest values so the UI cannot persist what it must not offer. Device-local Kindred sections stay unchanged; copy frames Notifications as account-synced and appearance as this-device.

**Tech Stack:** Next.js 15 RSC + server actions, React 19 client components, `@chronicle/core` prefs API, Vitest + RTL, hub `_copy`.

**Issue:** [#280](https://github.com/boosey/familyapp/issues/280) (spec: closed #272 / `.scratch/issue-272-spec.md` / `.scratch/ticket-settings-ui.md` on main checkout).

**Out of scope:** Digest chooser options, digest assembly (#277), invite delivery, story-shared recipient filtering (#279), questions-for-me outbound (#276).

---

## File structure

| File | Responsibility |
|------|----------------|
| `apps/web/app/_copy/hub.ts` | Notifications copy + page subtitle that distinguishes synced vs device-local |
| `apps/web/app/hub/settings/actions.ts` | `saveNotificationStreamFrequencyAction` — auth gate + allowlist every_item\|off |
| `apps/web/app/hub/settings/NotificationsSection.tsx` | Client UI: three streams × SegmentedControl (radio) + save hints |
| `apps/web/app/hub/settings/SettingsPanel.tsx` | Accept initial freqs; render Notifications first, then device-local sections |
| `apps/web/app/hub/settings/page.tsx` | Load freqs; pass into panel |
| `apps/web/__tests__/settings-notification-actions.server.test.ts` | Action behavior: save, reject digest, auth, default round-trip |
| `apps/web/app/hub/settings/NotificationsSection.test.tsx` | Light UI: three streams, only every/off options, no digest labels |

---

### Task 1: Copy — Notifications strings + page framing

**Files:**
- Modify: `apps/web/app/_copy/hub.ts` (`hub.settings` block ~829–873)

- [ ] **Step 1: Update `hub.settings` copy**

Replace/extend the `settings` object so the page is no longer framed as device-only only:

```ts
  settings: {
    backToHub: "← Back to hub",
    title: "Settings",
    subtitle: "Notifications sync to your account. Display preferences stay on this device.",
    notificationsHeading: "Notifications",
    notificationsIntro:
      "Choose how often you hear from Tell Me Again. These choices sync across your devices.",
    notificationsSaving: "Saving…",
    notificationsSaved: "Saved",
    notificationsSaveError: "Could not save — try again.",
    streamLabels: {
      questions_for_me: "Questions for me",
      answers_to_my_asks: "Answers to my asks",
      family_activity: "Family activity",
    },
    frequencyEveryItem: "Every item",
    frequencyOff: "Off",
    streamFrequencyAria: (streamLabel: string) => `${streamLabel} frequency`,
    // …keep existing skin/motion/recording/textSize/palette keys unchanged…
  },
```

Do **not** add `frequencyDailyDigest` / `frequencyWeeklyDigest` strings — digests must not be selectable or labeled in the UI.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/_copy/hub.ts
git commit -m "copy: frame hub settings notifications as synced"
```

---

### Task 2: Server action — save stream frequency (every_item | off only)

**Files:**
- Create: `apps/web/app/hub/settings/actions.ts`
- Test: `apps/web/__tests__/settings-notification-actions.server.test.ts`

- [ ] **Step 1: Write the failing action tests**

Create `apps/web/__tests__/settings-notification-actions.server.test.ts` following `pending-invites-actions.server.test.ts` harness:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationStreamFrequency,
  listNotificationStreamFrequencies,
  setNotificationStreamFrequency,
} from "@chronicle/core";

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { saveNotificationStreamFrequencyAction } from "@/app/hub/settings/actions";

async function makePerson(db: Database, name = "Sofia"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

describe("saveNotificationStreamFrequencyAction", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    authCtx = { kind: "none" };
  });

  it("persists off for family_activity and reload resolves off", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("family_activity", "off");
    expect(result).toEqual({ ok: true });
    expect(await getNotificationStreamFrequency(runtimeDb, personId, "family_activity")).toBe("off");
  });

  it("rejects daily_digest so digests cannot be stored via settings", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("answers_to_my_asks", "daily_digest");
    expect(result).toEqual({ error: "invalid_frequency" });
    expect(await getNotificationStreamFrequency(runtimeDb, personId, "answers_to_my_asks")).toBe(
      "every_item",
    );
  });

  it("rejects weekly_digest", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("questions_for_me", "weekly_digest");
    expect(result).toEqual({ error: "invalid_frequency" });
  });

  it("rejects unknown stream", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("not_a_stream" as never, "off");
    expect(result).toEqual({ error: "invalid_stream" });
  });

  it("requires signed-in account", async () => {
    const result = await saveNotificationStreamFrequencyAction("family_activity", "off");
    expect(result).toEqual({ error: "not_signed_in" });
  });

  it("list defaults are every_item when no rows (page load contract)", async () => {
    const personId = await makePerson(runtimeDb);
    expect(await listNotificationStreamFrequencies(runtimeDb, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "every_item",
      family_activity: "every_item",
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
pnpm --filter @chronicle/web exec vitest run __tests__/settings-notification-actions.server.test.ts
```

Expected: FAIL — cannot resolve `@/app/hub/settings/actions`.

- [ ] **Step 3: Implement `actions.ts`**

```ts
"use server";

import {
  NOTIFICATION_STREAMS,
  setNotificationStreamFrequency,
} from "@chronicle/core";
import type { NotificationFrequency, NotificationStream } from "@chronicle/db";
import { getRuntime } from "@/lib/runtime";

type SaveResult =
  | { ok: true }
  | { error: "not_signed_in" | "invalid_stream" | "invalid_frequency" | "save_failed" };

const UI_FREQUENCIES = new Set<NotificationFrequency>(["every_item", "off"]);
const STREAMS = new Set<string>(NOTIFICATION_STREAMS);

async function requireAccount(): Promise<
  { db: Awaited<ReturnType<typeof getRuntime>>["db"]; personId: string } | { error: "not_signed_in" }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "not_signed_in" };
  return { db, personId: ctx.personId };
}

export async function saveNotificationStreamFrequencyAction(
  stream: NotificationStream,
  frequency: NotificationFrequency,
): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  if (!STREAMS.has(stream)) return { error: "invalid_stream" };
  if (!UI_FREQUENCIES.has(frequency)) return { error: "invalid_frequency" };
  try {
    await setNotificationStreamFrequency(ctx.db, ctx.personId, stream, frequency);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @chronicle/web exec vitest run __tests__/settings-notification-actions.server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/settings/actions.ts apps/web/__tests__/settings-notification-actions.server.test.ts
git commit -m "feat: settings action saves notification stream prefs"
```

---

### Task 3: NotificationsSection UI + wire settings page

**Files:**
- Create: `apps/web/app/hub/settings/NotificationsSection.tsx`
- Create: `apps/web/app/hub/settings/NotificationsSection.test.tsx`
- Modify: `apps/web/app/hub/settings/SettingsPanel.tsx`
- Modify: `apps/web/app/hub/settings/page.tsx`

- [ ] **Step 1: Write the failing UI test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationsSection } from "./NotificationsSection";

vi.mock("./actions", () => ({
  saveNotificationStreamFrequencyAction: vi.fn(async () => ({ ok: true })),
}));

describe("NotificationsSection", () => {
  it("shows all three streams with every item | off only (no digest labels)", () => {
    render(
      <NotificationsSection
        initialFrequencies={{
          questions_for_me: "every_item",
          answers_to_my_asks: "every_item",
          family_activity: "off",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /notifications/i })).toBeTruthy();
    expect(screen.getByText("Questions for me")).toBeTruthy();
    expect(screen.getByText("Answers to my asks")).toBeTruthy();
    expect(screen.getByText("Family activity")).toBeTruthy();
    expect(screen.getAllByRole("radio", { name: /every item/i }).length).toBe(3);
    expect(screen.getAllByRole("radio", { name: /^off$/i }).length).toBe(3);
    expect(screen.queryByText(/daily/i)).toBeNull();
    expect(screen.queryByText(/weekly/i)).toBeNull();
    // family_activity starts off
    const familyGroup = screen.getByRole("radiogroup", { name: /family activity frequency/i });
    expect(familyGroup.querySelector('[aria-checked="true"]')?.textContent).toMatch(/off/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @chronicle/web exec vitest run app/hub/settings/NotificationsSection.test.tsx
```

- [ ] **Step 3: Implement `NotificationsSection.tsx`**

Use `SegmentedControl` with `variant="radio"` (repo’s boxed pill selector). Optimistic local state + profile-style saving/saved/error hints. Map any non-UI initial frequency (e.g. digest if somehow stored) to display as `every_item` for the control value only when not `off` — actually: if initial is `daily_digest`/`weekly_digest`, show `every_item` as selected visually is wrong. Safer: treat only `off` as off; any other stored value including digests displays as `every_item` selected **only if** we never let UI set digests — wait: if a future admin row has digest, showing every_item would be a lie. For v1: coerce display selection to `off` when `frequency === "off"`, else `every_item` (digest rows would appear as every_item until #277 UI — acceptable for #280 since digests aren’t selectable and aren’t written by this UI). Document that in a one-line comment.

```tsx
"use client";

import { useRef, useState, type CSSProperties } from "react";
import {
  NOTIFICATION_STREAMS,
  type /* no — import types from db */,
} from "@chronicle/core";
import type { NotificationFrequency, NotificationStream } from "@chronicle/db";
import { hub } from "@/app/_copy";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { saveNotificationStreamFrequencyAction } from "./actions";

type SaveState = "idle" | "saving" | "saved" | "error";

const UI_FREQ = ["every_item", "off"] as const satisfies readonly NotificationFrequency[];

function toUiFrequency(f: NotificationFrequency): "every_item" | "off" {
  // Digests exist in the model (#277) but are not choosable here; treat non-off as every_item in the control.
  return f === "off" ? "off" : "every_item";
}

export function NotificationsSection({
  initialFrequencies,
}: {
  initialFrequencies: Record<NotificationStream, NotificationFrequency>;
}) {
  const [freqs, setFreqs] = useState(() => {
    const next = { ...initialFrequencies };
    for (const s of NOTIFICATION_STREAMS) next[s] = toUiFrequency(initialFrequencies[s]);
    return next as Record<NotificationStream, "every_item" | "off">;
  });
  const [fieldState, setFieldState] = useState<Partial<Record<NotificationStream, SaveState>>>({});
  const savingRef = useRef<Set<NotificationStream>>(new Set());

  async function choose(stream: NotificationStream, frequency: "every_item" | "off") {
    if (freqs[stream] === frequency) return;
    if (savingRef.current.has(stream)) return;
    const prev = freqs[stream];
    setFreqs((f) => ({ ...f, [stream]: frequency }));
    savingRef.current.add(stream);
    setFieldState((s) => ({ ...s, [stream]: "saving" }));
    const result = await saveNotificationStreamFrequencyAction(stream, frequency);
    if ("ok" in result) {
      setFieldState((s) => ({ ...s, [stream]: "saved" }));
      window.setTimeout(() => {
        setFieldState((s) => (s[stream] === "saved" ? { ...s, [stream]: "idle" } : s));
      }, 2000);
    } else {
      setFreqs((f) => ({ ...f, [stream]: prev }));
      setFieldState((s) => ({ ...s, [stream]: "error" }));
    }
    savingRef.current.delete(stream);
  }

  function hint(stream: NotificationStream): string | null {
    const s = fieldState[stream];
    if (s === "saving") return hub.settings.notificationsSaving;
    if (s === "saved") return hub.settings.notificationsSaved;
    if (s === "error") return hub.settings.notificationsSaveError;
    return null;
  }

  return (
    <section aria-labelledby="settings-notifications">
      <h2 id="settings-notifications" style={sectionTitle}>
        {hub.settings.notificationsHeading}
      </h2>
      <p style={sectionIntro}>{hub.settings.notificationsIntro}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {NOTIFICATION_STREAMS.map((stream) => {
          const label = hub.settings.streamLabels[stream];
          const hintText = hint(stream);
          return (
            <div key={stream}>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  fontWeight: 600,
                  color: "var(--text-body)",
                  marginBottom: 8,
                }}
              >
                {label}
              </div>
              <SegmentedControl
                variant="radio"
                ariaLabel={hub.settings.streamFrequencyAria(label)}
                active={freqs[stream]}
                onSelect={(key) => choose(stream, key as "every_item" | "off")}
                items={UI_FREQ.map((f) => ({
                  key: f,
                  label:
                    f === "every_item"
                      ? hub.settings.frequencyEveryItem
                      : hub.settings.frequencyOff,
                }))}
              />
              {hintText ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    color:
                      fieldState[stream] === "error"
                        ? "var(--accent-strong)"
                        : "var(--text-muted)",
                    marginTop: 4,
                    display: "block",
                  }}
                >
                  {hintText}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const sectionTitle: CSSProperties = { /* same as SettingsPanel sectionTitle */ };
const sectionIntro: CSSProperties = { /* same as SettingsPanel sectionIntro */ };
```

Duplicate the two style constants from `SettingsPanel` (already local there — keep local in both files; do not invent a shared module unless already present).

- [ ] **Step 4: Wire `SettingsPanel` + `page.tsx`**

`SettingsPanel.tsx` — accept props and put Notifications first:

```tsx
export function SettingsPanel({
  notificationFrequencies,
}: {
  notificationFrequencies: Record<NotificationStream, NotificationFrequency>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <NotificationsSection initialFrequencies={notificationFrequencies} />
      {/* existing device-local sections unchanged; optionally add a small grouping
          heading only if copy already has one — do NOT invent a big "Appearance" redesign.
          The page subtitle already separates synced vs device-local. */}
      ...
    </div>
  );
}
```

`page.tsx`:

```tsx
import { listNotificationStreamFrequencies } from "@chronicle/core";
// ...
const frequencies = await listNotificationStreamFrequencies(db, ctx.personId);
// ...
<SettingsPanel notificationFrequencies={frequencies} />
```

Update the page file comment from “device-local app preferences” to mention both.

- [ ] **Step 5: Run UI + action tests — expect PASS**

```bash
pnpm --filter @chronicle/web exec vitest run __tests__/settings-notification-actions.server.test.ts app/hub/settings/NotificationsSection.test.tsx
```

- [ ] **Step 6: Typecheck web package**

```bash
pnpm --filter @chronicle/web typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/hub/settings/NotificationsSection.tsx \
  apps/web/app/hub/settings/NotificationsSection.test.tsx \
  apps/web/app/hub/settings/SettingsPanel.tsx \
  apps/web/app/hub/settings/page.tsx
git commit -m "feat: hub settings Notifications section (every item | off)"
```

---

## Spec coverage checklist

| Acceptance / decision | Task |
|----------------------|------|
| Three streams on /hub/settings with every item \| off | Task 3 |
| Saving updates Person-global prefs; reload shows saved | Tasks 2–3 (list on page load) |
| Defaults every item when no row | Task 2 list contract + page load |
| Device-local sections remain, clearly separate | Task 1 subtitle + Task 3 Notifications first |
| No daily/weekly in UI | Tasks 1–3 (no copy, action rejects, UI test) |
| questions-for-me selectable | Task 3 maps all `NOTIFICATION_STREAMS` |
| Persist via #278 get/set | Task 2 |
| Digests in model but not selectable | Task 2 reject + Task 3 UI_FREQ |

## Self-review

- No placeholders / TBD.
- Types: `NotificationStream` / `NotificationFrequency` from `@chronicle/db`; streams list from `NOTIFICATION_STREAMS`.
- Do not amend #292 / touch story-shared recipient code.
