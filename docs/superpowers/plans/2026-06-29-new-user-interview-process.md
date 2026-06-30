# New User Interview Process Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the biographical-intake pass, deeplink-ask priority, first-session welcome opener, and biographical extraction (per-intake-turn + post-approval) that complete the new-user interview experience.

**Architecture:** A new `intake` `PromptIntent` sits between warm callback and pending Asks in the picker. Intake questions target named fields on a new `BiographicalProfile` type stored in the existing `persons.biographical_anchors` JSONB column. **Intake answers are ephemeral — they are NOT Stories.** The turn loop transcribes/receives the answer (voice→STT or keyboard, both handled by the web surface), extracts the single targeted field via the LLM, and writes it to the profile; no Media row, no Story, nothing surfaced to family. Completeness is tracked by field population (null = unknown). A deeplink `targetAskId` bypasses all ordering to serve a specific Ask first.

**Tech Stack:** TypeScript strict ESM, Drizzle ORM + PGlite (tests), Vitest, Next.js 15 (hub UI), pnpm workspaces monorepo.

---

## Decisions captured during design + Opus review (do not re-litigate)

- **One user type.** "Narrator"/"asker" are actions, not account categories. Docs already updated (CONTEXT.md, Personas, Spec).
- **Intake answers are EPHEMERAL.** They populate `biographical_anchors` only. They are never recorded as Stories, never approved, never shown to family. → No capture/ingest path, no Story rows, no schema change to `stories`.
- **Keyboard always available.** Because intake is ephemeral, keyboard intake is just text→extract→write — it needs none of the text-*story* machinery. (Text *stories* for actual storytelling are deferred to **Plan B**, see end of doc.)
- **Intake questions are open-ended**, per the interviewer's non-negotiable "NEVER yes/no" rule. Booleans (`hasChildren`/`hasGrandchildren`) are *inferred by extraction* from open answers, not asked as yes/no.
- **Per-turn extraction is the collection mechanism.** After an intake answer, the turn loop extracts the one targeted field and calls `writeProfileField`. (This was missing from the first draft — it is the heart of the feature.)
- **Deeplink Ask is priority 1** when a session carries an `askId` from a notification.
- **Welcome opener** fires on the first turn of a first-ever session, bundled with the first intake question — not a separate turn.
- **Post-approval extraction** augments the profile from approved story transcripts, never overwriting a field already populated by a direct intake answer.
- **Session snapshot stays immutable mid-session** (existing invariant). A field written during a session is visible *next* session; within-session re-asking is prevented by `askedIntakeKeys`, not by mutating the snapshot.

---

## File map

### New files
| File | Purpose |
|------|---------|
| `packages/interviewer/src/questions/intake.ts` | 6 open-ended intake questions + `nextIntakeQuestion` selector |
| `packages/interviewer/src/intake-extraction.ts` | `extractIntakeAnswer` — single-field extraction from one answer |
| `apps/web/src/app/hub/_components/IntakeReminder.tsx` | Hub banner when biographical profile incomplete |

### Modified files
| File | What changes |
|------|-------------|
| `packages/db/src/schema.ts` | Add `BiographicalProfile` type; retype `biographicalAnchors` JSONB `$type` (compile-time only — no DDL change) |
| `packages/db/src/index.ts` | Export `BiographicalProfile` |
| `packages/interviewer/src/contracts.ts` | `BiographicalAnchors.anchors` → `profile: BiographicalProfile`; add `writeProfileField` to `AnchorSource`; re-export `BiographicalProfile` |
| `packages/interviewer/src/behavior.ts` | Add `intake` `PromptIntent`; `askedIntakeKeys` on `SessionState`; `anchors` + `targetAskId` on `PickInput`; revise `pickNextIntent`; update `recordTurnCompleted` |
| `packages/interviewer/src/phraser.ts` | Handle `intake` intent; first-session welcome opener; `renderContextBlock` reads named profile fields |
| `packages/interviewer/src/turn-loop.ts` | `targetAskId?` on options; pass `anchors`+`targetAskId` to picker; pass `isFirstSession` to phraser; **`recordResponse` becomes async and runs per-turn intake extraction → `writeProfileField`** |
| `packages/interviewer/src/core-adapters.ts` | Map stored JSONB → `profile`; implement `writeProfileField` (JSONB merge) |
| `packages/interviewer/src/mocks.ts` | `InMemoryAnchorSource`: `profile` + `writeProfileField`; `ScriptedLanguageModel` gains an `onComplete` inspection hook |
| `packages/interviewer/test/interviewer.test.ts` | New tests across all tasks |
| `packages/pipeline/src/extract-biography.ts` (new) + orchestrator | Post-approval full-profile extraction step |
| `apps/web/src/app/hub/page.tsx` | Render `IntakeReminder` |

---

## Task 1 — `BiographicalProfile` type (db, compile-time only)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/index.ts`

No DDL change — `biographical_anchors` is already a JSONB column. We only give it a precise compile-time `$type`.

- [ ] **Step 1: Add `BiographicalProfile` before the `persons` table (~line 120) in `schema.ts`**

```typescript
/**
 * Named biographical facts collected by the EPHEMERAL intake pass and inferred from approved
 * stories. Stored in `persons.biographical_anchors` (JSONB). All fields nullable — null means
 * "not yet known". The picker checks these to decide which intake questions remain. Story
 * extraction never overwrites a non-null value.
 */
export interface BiographicalProfile {
  hometown: string | null;
  siblingContext: string | null;
  currentLocation: string | null;
  occupationSummary: string | null;
  hasChildren: boolean | null;
  hasGrandchildren: boolean | null;
}
```

- [ ] **Step 2: Retype the `biographicalAnchors` column**

Change:
```typescript
biographicalAnchors: jsonb("biographical_anchors")
  .$type<Record<string, unknown>>()
  .default(sql`'{}'::jsonb`),
```
to:
```typescript
biographicalAnchors: jsonb("biographical_anchors")
  .$type<Partial<BiographicalProfile>>()
  .default(sql`'{}'::jsonb`),
```

- [ ] **Step 3: Export the type from `packages/db/src/index.ts`**

Add to the existing `export type { ... } from "./schema";` block:
```typescript
  BiographicalProfile,
```

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @chronicle/db typecheck`
Expected: PASS (this is a type-only change; if `getNarratorBiographicalContext` in core returns `Record<string, unknown>` for anchors, that still assigns to `Partial<BiographicalProfile>` only at the interviewer boundary — handled in Task 7, not here).

- [ ] **Step 5: Run db tests**

Run: `pnpm --filter @chronicle/db test`
Expected: all PASS (no DDL change, schema applies identically).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/index.ts
git commit -m "feat(db): add BiographicalProfile type for biographical_anchors"
```

---

## Task 2 — `BiographicalAnchors` contract + mocks

**Files:**
- Modify: `packages/interviewer/src/contracts.ts`
- Modify: `packages/interviewer/src/mocks.ts`
- Modify: `packages/interviewer/test/interviewer.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/interviewer/test/interviewer.test.ts`:

```typescript
import type { BiographicalProfile } from "@chronicle/db";

const EMPTY_PROFILE: BiographicalProfile = {
  hometown: null, siblingContext: null, currentLocation: null,
  occupationSummary: null, hasChildren: null, hasGrandchildren: null,
};

describe("BiographicalAnchors — typed profile", () => {
  it("InMemoryAnchorSource returns typed profile fields", async () => {
    const source = new InMemoryAnchorSource();
    source.set("p1", { personId: "p1", spokenName: "Eleanor", birthYear: 1943,
      profile: { ...EMPTY_PROFILE, hometown: "New Orleans", hasChildren: true } });
    const anchors = await source.loadForNarrator("p1");
    expect(anchors?.profile.hometown).toBe("New Orleans");
    expect(anchors?.profile.hasChildren).toBe(true);
    expect(anchors?.profile.siblingContext).toBeNull();
  });

  it("writeProfileField updates one field without overwriting others", async () => {
    const source = new InMemoryAnchorSource();
    source.set("p1", { personId: "p1", spokenName: "Eleanor", birthYear: 1943,
      profile: { ...EMPTY_PROFILE, hometown: "New Orleans" } });
    await source.writeProfileField("p1", "siblingContext", "Youngest of three");
    const updated = await source.loadForNarrator("p1");
    expect(updated?.profile.siblingContext).toBe("Youngest of three");
    expect(updated?.profile.hometown).toBe("New Orleans");
  });
});
```

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "BiographicalAnchors"`
Expected: FAIL.

- [ ] **Step 2: Update `contracts.ts`**

Replace the `BiographicalAnchors` interface and `AnchorSource`:

```typescript
import type { BiographicalProfile } from "@chronicle/db";

export type { BiographicalProfile };

export interface BiographicalAnchors {
  personId: string;
  spokenName: string;
  birthYear: number | null;
  /** Named biographical facts from the intake pass and story extraction. */
  profile: BiographicalProfile;
}

export interface AnchorSource {
  loadForNarrator(personId: string): Promise<BiographicalAnchors | null>;
  /**
   * Write a single biographical profile field. Called by the turn loop after an intake answer is
   * extracted, and by the post-approval pipeline step. Never call with null — null means "unknown",
   * and we never downgrade a known field back to unknown.
   */
  writeProfileField<K extends keyof BiographicalProfile>(
    personId: string,
    key: K,
    value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void>;
}
```

- [ ] **Step 3: Update `InMemoryAnchorSource` in `mocks.ts`**

```typescript
import type { BiographicalProfile } from "@chronicle/db";
import type { AnchorSource, BiographicalAnchors } from "./contracts";

export class InMemoryAnchorSource implements AnchorSource {
  private store = new Map<string, BiographicalAnchors>();

  set(personId: string, anchors: BiographicalAnchors): void {
    this.store.set(personId, anchors);
  }

  async loadForNarrator(personId: string): Promise<BiographicalAnchors | null> {
    return this.store.get(personId) ?? null;
  }

  async writeProfileField<K extends keyof BiographicalProfile>(
    personId: string, key: K, value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void> {
    const existing = this.store.get(personId);
    if (!existing) return;
    this.store.set(personId, { ...existing, profile: { ...existing.profile, [key]: value } });
  }
}
```

- [ ] **Step 4: Run tests + full suite**

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "BiographicalAnchors"` → PASS
Run: `pnpm --filter @chronicle/interviewer test`
Expected: failures only where existing code/tests reference the old `anchors` field — those are fixed in Tasks 5 & 7. If the suite is red solely on `.anchors` references, that is expected at this checkpoint; proceed.

- [ ] **Step 5: Commit**

```bash
git add packages/interviewer/src/contracts.ts packages/interviewer/src/mocks.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): typed BiographicalProfile on AnchorSource + writeProfileField"
```

---

## Task 3 — Intake question bank (open-ended)

**Files:**
- Create: `packages/interviewer/src/questions/intake.ts`

- [ ] **Step 1: Write failing tests**

Add to `interviewer.test.ts`:

```typescript
import { nextIntakeQuestion, INTAKE_QUESTIONS } from "../src/questions/intake";

describe("Intake question bank", () => {
  it("returns first question when profile is empty", () => {
    expect(nextIntakeQuestion(EMPTY_PROFILE, new Set())?.key).toBe("hometown");
  });
  it("skips already-asked keys", () => {
    expect(nextIntakeQuestion(EMPTY_PROFILE, new Set(["hometown"]))?.key).toBe("siblingContext");
  });
  it("skips populated fields", () => {
    expect(nextIntakeQuestion({ ...EMPTY_PROFILE, hometown: "NOLA" }, new Set())?.key).toBe("siblingContext");
  });
  it("skips hasGrandchildren when hasChildren is null", () => {
    const p = { ...EMPTY_PROFILE, hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: null };
    expect(nextIntakeQuestion(p, new Set())).toBeNull();
  });
  it("asks hasGrandchildren when hasChildren is true", () => {
    const p = { ...EMPTY_PROFILE, hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: true };
    expect(nextIntakeQuestion(p, new Set())?.key).toBe("hasGrandchildren");
  });
  it("returns null when all applicable fields populated (no children)", () => {
    const p: BiographicalProfile = { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null };
    expect(nextIntakeQuestion(p, new Set())).toBeNull();
  });
  it("no INTAKE question uses yes/no framing", () => {
    for (const q of INTAKE_QUESTIONS) {
      expect(q.text.toLowerCase()).not.toMatch(/^(do|did|are|is|have|has|were|was) you/);
    }
  });
});
```

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "Intake question bank"` → FAIL.

- [ ] **Step 2: Create `packages/interviewer/src/questions/intake.ts`**

```typescript
/**
 * Structured intake questions — asked once per narrator to populate BiographicalProfile.
 * EPHEMERAL: intake answers are NOT stories. They populate the profile and are discarded.
 *
 * DRAFTING RULES (same as bank.ts — load-bearing):
 *   - Open-ended ("Tell me about…"). NEVER yes/no. Booleans are INFERRED by extraction.
 *   - One question per item; no compound asks.
 *   - Concrete, warm, non-judgmental.
 */
import type { BiographicalProfile } from "@chronicle/db";

export interface IntakeQuestion {
  key: keyof BiographicalProfile;
  /** Topic seed — re-rendered warm by the phraser; not read verbatim. Open-ended. */
  text: string;
  /** Extraction hint: tells the per-turn extractor what structured value to return. */
  extractionHint: string;
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "hometown",
    text: "Tell me about where you grew up — the town, the neighborhood, the place it was.",
    extractionHint:
      "Extract the town/city/region where the narrator grew up, as a short string (e.g. 'New Orleans, Louisiana' or 'a farm outside Shreveport'). Return null if not stated.",
  },
  {
    key: "siblingContext",
    text: "Tell me about your brothers and sisters, if you had any growing up.",
    extractionHint:
      "Summarize the sibling situation in 1–2 sentences (e.g. 'Oldest of four' or 'Only child'). Return null if not stated.",
  },
  {
    key: "currentLocation",
    text: "Where has life taken you since — where do you call home these days?",
    extractionHint:
      "Extract the narrator's current city/region; note relocation if mentioned (e.g. 'Houston — moved from New Orleans in 1985'). Return null if not stated.",
  },
  {
    key: "occupationSummary",
    text: "Tell me about the work you've done over the years.",
    extractionHint:
      "Summarize the primary occupation/career in 1–2 sentences (e.g. 'Schoolteacher for 30 years'). Return null if not stated.",
  },
  {
    key: "hasChildren",
    text: "Tell me about your children, if you have any.",
    extractionHint:
      "Infer a boolean: true if the narrator indicates they have children, false if they indicate they do not, null if unclear.",
  },
  {
    key: "hasGrandchildren",
    text: "And your grandchildren — tell me about them.",
    extractionHint:
      "Infer a boolean: true if the narrator indicates they have grandchildren, false if not, null if unclear. Only asked when hasChildren is true.",
  },
];

/**
 * Next intake question not yet asked this session and whose profile field is still null.
 * Returns null when all applicable questions are complete.
 */
export function nextIntakeQuestion(
  profile: Partial<BiographicalProfile>,
  askedKeys: ReadonlySet<keyof BiographicalProfile>,
): IntakeQuestion | null {
  for (const q of INTAKE_QUESTIONS) {
    if (askedKeys.has(q.key)) continue;
    const value = profile[q.key];
    if (value !== undefined && value !== null) continue;
    if (q.key === "hasGrandchildren" && profile.hasChildren !== true) continue;
    return q;
  }
  return null;
}
```

- [ ] **Step 3: Run tests** → `pnpm --filter @chronicle/interviewer exec vitest run -t "Intake question bank"` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/interviewer/src/questions/intake.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): open-ended intake bank + nextIntakeQuestion selector"
```

---

## Task 4 — Behavior: intake intent + deeplink priority

**Files:**
- Modify: `packages/interviewer/src/behavior.ts`
- Modify: `packages/interviewer/test/interviewer.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `interviewer.test.ts`:

```typescript
import type { BiographicalAnchors } from "../src/contracts";

function anchorsWith(profile: Partial<BiographicalProfile> = {}): BiographicalAnchors {
  return { personId: "p1", spokenName: "Eleanor", birthYear: 1943,
    profile: { ...EMPTY_PROFILE, ...profile } };
}
const PRIOR = [{ storyId: "s1", title: "The farm", summary: "A farm", tags: [], promptQuestion: null, createdAt: new Date() }];

describe("Picker — intake priority", () => {
  it("returns intake when profile has nulls and no deeplink/callback", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [], anchors: anchorsWith() });
    expect(i.kind).toBe("intake");
    expect((i as any).questionKey).toBe("hometown");
  });
  it("callback beats intake on turn 0 with prior stories", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: PRIOR, anchors: anchorsWith() });
    expect(i.kind).toBe("callback");
  });
  it("intake resumes from next null field", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [],
      anchors: anchorsWith({ hometown: "NOLA", siblingContext: "Only child" }) });
    expect((i as any).questionKey).toBe("currentLocation");
  });
  it("askedIntakeKeys skips a key already asked this session", () => {
    const s = createSessionState("p1"); s.askedIntakeKeys.add("hometown");
    const i = pickNextIntent({ state: s, pendingAsks: [], priorStories: [], anchors: anchorsWith() });
    expect((i as any).questionKey).toBe("siblingContext");
  });
  it("falls to pending asks once intake complete", () => {
    const full = { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null };
    const i = pickNextIntent({ state: createSessionState("p1"),
      pendingAsks: [{ askId: "a1", askerName: "Sofia", questionText: "Music?" }], priorStories: [], anchors: anchorsWith(full) });
    expect(i.kind).toBe("ask");
  });
  it("with null anchors, intake is skipped (falls to base bank)", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [], anchors: null });
    expect(i.kind).toBe("base");
  });
});

describe("Picker — deeplink ask", () => {
  it("serves deeplink ask first, before callback and intake", () => {
    const s = createSessionState("p1");
    const i = pickNextIntent({ state: s,
      pendingAsks: [{ askId: "dl", askerName: "Marcus", questionText: "How'd you meet Dad?" }],
      priorStories: PRIOR, anchors: anchorsWith(), targetAskId: "dl" });
    expect(i.kind).toBe("ask");
    expect((i as any).askId).toBe("dl");
  });
  it("does not re-serve a consumed deeplink ask", () => {
    const s = createSessionState("p1"); s.consumedAskIds.add("dl");
    const i = pickNextIntent({ state: s,
      pendingAsks: [{ askId: "dl", askerName: "Marcus", questionText: "?" }],
      priorStories: [], anchors: anchorsWith(), targetAskId: "dl" });
    expect(i.kind).toBe("intake");
  });
  it("unknown deeplink id falls through to normal priority", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [],
      anchors: anchorsWith(), targetAskId: "missing" });
    expect(i.kind).toBe("intake");
  });
});

describe("recordTurnCompleted — intake", () => {
  it("adds questionKey to askedIntakeKeys and increments turnCount", () => {
    const s = createSessionState("p1");
    recordTurnCompleted(s, { kind: "intake", questionKey: "hometown", questionText: "?", extractionHint: "h" });
    expect(s.askedIntakeKeys.has("hometown")).toBe(true);
    expect(s.turnCount).toBe(1);
  });
});
```

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "Picker —|recordTurnCompleted — intake"` → FAIL.

- [ ] **Step 2: Imports + `SessionState` + `createSessionState`**

In `behavior.ts` add imports:
```typescript
import type { BiographicalProfile } from "@chronicle/db";
import type { BiographicalAnchors, PendingAsk, PriorStoryMemory } from "./contracts";
import { nextIntakeQuestion } from "./questions/intake";
```
Add field to `SessionState`:
```typescript
  /** Intake keys asked this session — prevents re-asking even while the profile field is still null. */
  askedIntakeKeys: Set<keyof BiographicalProfile>;
```
Add to `createSessionState` return: `askedIntakeKeys: new Set(),`.

- [ ] **Step 3: Add `intake` to `PromptIntent`**

```typescript
  | { kind: "intake"; questionKey: keyof BiographicalProfile; questionText: string; extractionHint: string };
```

- [ ] **Step 4: Update `PickInput` + `pickNextIntent`**

```typescript
export interface PickInput {
  state: SessionState;
  pendingAsks: ReadonlyArray<PendingAsk>;
  priorStories: ReadonlyArray<PriorStoryMemory>;
  anchors: BiographicalAnchors | null;
  targetAskId?: string;
}

export function pickNextIntent(input: PickInput): PromptIntent {
  const { state, pendingAsks, priorStories, anchors, targetAskId } = input;

  // Interrupt: distress / off-ramp override everything.
  if (state.distressed) return { kind: "wind_down", reason: "distress", surfaceHumanSupport: true };
  if (state.offRampRequested) return { kind: "wind_down", reason: "off_ramp", surfaceHumanSupport: false };

  // 1. Deeplink Ask — a specific askId requested via notification.
  if (targetAskId && !state.consumedAskIds.has(targetAskId)) {
    const ask = pendingAsks.find((a) => a.askId === targetAskId);
    if (ask) return { kind: "ask", askId: ask.askId, askerName: ask.askerName, questionText: ask.questionText };
  }

  // 2. Warm callback on turn 0 when prior stories exist.
  if (state.turnCount === 0 && priorStories.length > 0) {
    const recent = priorStories[0]!;
    return { kind: "callback", priorStoryId: recent.storyId, priorTitle: recent.title, priorSummary: recent.summary };
  }

  // 3. Intake — next unanswered biographical field (only when we have an anchors record).
  if (anchors) {
    const q = nextIntakeQuestion(anchors.profile, state.askedIntakeKeys);
    if (q) return { kind: "intake", questionKey: q.key, questionText: q.text, extractionHint: q.extractionHint };
  }

  // 4. Pending Asks (priority desc, unused this session).
  const fresh = pendingAsks.filter((a) => !state.consumedAskIds.has(a.askId));
  if (fresh.length > 0) {
    const top = fresh.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]!;
    return { kind: "ask", askId: top.askId, askerName: top.askerName, questionText: top.questionText };
  }

  // 5. Follow-up on a substantial last utterance.
  const last = state.lastNarratorUtterance;
  if (last && last.trim().split(/\s+/).length >= 12) return { kind: "follow_up", threadSeed: last };

  // 6. Base bank — de-duped, sensitivity-gated, reminiscence-bump preferred.
  const eligible = QUESTION_BANK.filter((q) =>
    !state.askedQuestionIds.has(q.id) &&
    !state.coveredCategories.has(q.category) &&
    sensitivityAllowed(q.sensitivity, state));
  if (eligible.length === 0) return { kind: "wind_down", reason: "fatigue", surfaceHumanSupport: false };
  const preferred = eligible.filter((q) => REMINISCENCE_BUMP_PHASES.has(q.lifePhase));
  const pool = preferred.length > 0 ? preferred : eligible;
  return { kind: "base", question: pool[0]! };
}
```

- [ ] **Step 5: Add `intake` case to `recordTurnCompleted` switch**

```typescript
    case "intake":
      state.askedIntakeKeys.add(intent.questionKey);
      break;
```

- [ ] **Step 6: Run tests + full suite**

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "Picker —|recordTurnCompleted — intake"` → PASS.
Run: `pnpm --filter @chronicle/interviewer test` → fix any callers of `pickNextIntent` missing `anchors` (add `anchors: null`). Remaining red on `.anchors` (old field) is fixed in Tasks 5 & 7.

- [ ] **Step 7: Commit**

```bash
git add packages/interviewer/src/behavior.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): intake intent + deeplink ask priority in picker"
```

---

## Task 5 — Phraser: intake rendering + first-session opener

**Files:**
- Modify: `packages/interviewer/src/phraser.ts`
- Modify: `packages/interviewer/src/mocks.ts` (add `onComplete` hook to `ScriptedLanguageModel`)
- Modify: `packages/interviewer/test/interviewer.test.ts`

- [ ] **Step 1: Add an inspection hook to `ScriptedLanguageModel` in `mocks.ts`**

Locate `ScriptedLanguageModel`. Add an optional callback invoked inside `complete` with the messages:
```typescript
  /** Test hook: invoked with the messages on each complete() call. */
  onComplete?: (messages: LanguageModelMessage[]) => void;
```
Inside its `complete(req)` method, before returning, add: `this.onComplete?.(req.messages);`
(Import `LanguageModelMessage` from `@chronicle/pipeline` if not already.)

- [ ] **Step 2: Write failing tests**

```typescript
describe("Phraser — intake + opener", () => {
  function deps(llm: any, memory = new InMemoryMemorySource()) {
    return { languageModel: llm, voice: new ScriptedVoice(), askSource: new InMemoryAskSource(),
      memorySource: memory, anchorSource: (() => { const a = new InMemoryAnchorSource();
        a.set("p1", { personId: "p1", spokenName: "Eleanor", birthYear: 1943, profile: EMPTY_PROFILE }); return a; })() };
  }
  it("intake intent puts INTAKE QUESTION + field in the LLM prompt", async () => {
    const msgs: any[] = [];
    const llm = new ScriptedLanguageModel([{ text: "Where did you grow up?", modelId: "m1" }]);
    llm.onComplete = (m: any[]) => msgs.push(...m);
    const s = await createInterviewSession(deps(llm), { narratorPersonId: "p1" });
    await s.nextTurn();
    const user = msgs.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("INTAKE QUESTION");
    expect(user).toContain("hometown");
  });
  it("first session prepends the welcome opener", async () => {
    const msgs: any[] = [];
    const llm = new ScriptedLanguageModel([{ text: "Hi.", modelId: "m1" }]);
    llm.onComplete = (m: any[]) => msgs.push(...m);
    const s = await createInterviewSession(deps(llm), { narratorPersonId: "p1" });
    await s.nextTurn();
    expect(msgs.find((m) => m.role === "user")?.content).toContain("FIRST SESSION");
  });
  it("returning session (prior stories) does NOT prepend the opener", async () => {
    const msgs: any[] = [];
    const memory = new InMemoryMemorySource();
    memory.set("p1", PRIOR);
    const llm = new ScriptedLanguageModel([{ text: "Welcome back.", modelId: "m1" }]);
    llm.onComplete = (m: any[]) => msgs.push(...m);
    const s = await createInterviewSession(deps(llm, memory), { narratorPersonId: "p1" });
    await s.nextTurn();
    expect(msgs.find((m) => m.role === "user")?.content).not.toContain("FIRST SESSION");
  });
});
```

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "Phraser — intake"` → FAIL.

- [ ] **Step 3: Update `PhraseInput` + `buildMessages` in `phraser.ts`**

Add `isFirstSession: boolean;` to `PhraseInput`. Update `buildMessages`:
```typescript
function buildMessages(input: PhraseInput): LanguageModelMessage[] {
  const ctxBlock = renderContextBlock(input.anchors);
  const welcomeBlock =
    input.isFirstSession && input.intent.kind === "intake"
      ? `FIRST SESSION: Before the question, add a warm 1–2 sentence welcome that conveys: you'll ask about their life one question at a time; their own words and voice are what's preserved; there are no wrong answers and they can skip anything or stop whenever they like. Then flow straight into the question — no "here we go" filler.\n\n`
      : "";
  const userContent = `${ctxBlock}${welcomeBlock}TURN:\n${renderIntentBlock(input.intent, input.priorStories)}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
```

- [ ] **Step 4: Add `intake` case to `renderIntentBlock`**

```typescript
    case "intake":
      return `Type: INTAKE QUESTION — you are warmly building a biographical portrait of this narrator.
Field being collected: ${intent.questionKey}
Ask this in your warm voice (re-render naturally — do NOT read verbatim, keep it open-ended, 1–2 sentences):
"""${intent.questionText}"""
Curious and warm, never clinical or form-like. Never yes/no.`;
```

- [ ] **Step 5: Rewrite `renderContextBlock` for named fields**

```typescript
function renderContextBlock(anchors: BiographicalAnchors | null): string {
  if (!anchors) return "";
  const lines: string[] = [`Narrator's spoken name: ${anchors.spokenName}`];
  if (anchors.birthYear !== null) lines.push(`Approximate birth year: ${anchors.birthYear}`);
  const p = anchors.profile;
  if (p.hometown) lines.push(`Hometown: ${p.hometown}`);
  if (p.currentLocation) lines.push(`Current location: ${p.currentLocation}`);
  if (p.occupationSummary) lines.push(`Occupation: ${p.occupationSummary}`);
  if (p.siblingContext) lines.push(`Sibling context: ${p.siblingContext}`);
  if (p.hasChildren != null) lines.push(`Has children: ${p.hasChildren ? "yes" : "no"}`);
  if (p.hasGrandchildren != null) lines.push(`Has grandchildren: ${p.hasGrandchildren ? "yes" : "no"}`);
  return `CONTEXT (hints only — do not state any of these as fact unless the narrator confirms):\n${lines.join("\n")}\n\n`;
}
```

- [ ] **Step 6: Run tests** → `-t "Phraser — intake"` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/interviewer/src/phraser.ts packages/interviewer/src/mocks.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): phraser intake rendering + first-session welcome opener"
```

---

## Task 6 — Intake answer extractor (single field)

**Files:**
- Create: `packages/interviewer/src/intake-extraction.ts`
- Modify: `packages/interviewer/test/interviewer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { extractIntakeAnswer } from "../src/intake-extraction";
import { INTAKE_QUESTIONS } from "../src/questions/intake";

describe("extractIntakeAnswer", () => {
  const hometownQ = INTAKE_QUESTIONS.find((q) => q.key === "hometown")!;
  const childrenQ = INTAKE_QUESTIONS.find((q) => q.key === "hasChildren")!;

  it("extracts a string field", async () => {
    const llm = new ScriptedLanguageModel([{ text: JSON.stringify({ value: "New Orleans" }), modelId: "m1" }]);
    const v = await extractIntakeAnswer(llm, hometownQ, "Oh, I grew up in New Orleans.");
    expect(v).toBe("New Orleans");
  });
  it("infers a boolean field", async () => {
    const llm = new ScriptedLanguageModel([{ text: JSON.stringify({ value: true }), modelId: "m1" }]);
    const v = await extractIntakeAnswer(llm, childrenQ, "Yes, three of them.");
    expect(v).toBe(true);
  });
  it("returns null when the model returns null", async () => {
    const llm = new ScriptedLanguageModel([{ text: JSON.stringify({ value: null }), modelId: "m1" }]);
    expect(await extractIntakeAnswer(llm, hometownQ, "I'd rather not say.")).toBeNull();
  });
  it("returns null on unparseable output", async () => {
    const llm = new ScriptedLanguageModel([{ text: "not json", modelId: "m1" }]);
    expect(await extractIntakeAnswer(llm, hometownQ, "...")).toBeNull();
  });
});
```

Run: `-t "extractIntakeAnswer"` → FAIL.

- [ ] **Step 2: Create `packages/interviewer/src/intake-extraction.ts`**

```typescript
/**
 * Per-turn intake extraction. After the narrator answers an intake question, pull the ONE
 * structured value that question targets. Ephemeral: the answer text is not stored; only the
 * extracted value is written to the profile. Returns null when nothing confident is present.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { IntakeQuestion } from "./questions/intake";

const SYSTEM_PROMPT = `You extract ONE structured biographical value from a person's spoken answer.
Return ONLY raw JSON of the form {"value": ...} — no markdown, no prose.
Follow the extraction instruction exactly. If the value is not clearly present, return {"value": null}.`;

export async function extractIntakeAnswer(
  llm: LanguageModel,
  question: IntakeQuestion,
  answer: string,
): Promise<string | boolean | null> {
  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content:
        `EXTRACTION INSTRUCTION: ${question.extractionHint}\n\nThe person was asked: "${question.text}"\nTheir answer: """${answer}"""` },
    ],
    responseFormat: "text",
    temperature: 0,
    maxOutputTokens: 200,
  });
  try {
    const parsed = JSON.parse(res.text.trim()) as { value?: unknown };
    const v = parsed.value;
    if (typeof v === "string") return v.trim() === "" ? null : v.trim();
    if (typeof v === "boolean") return v;
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run tests** → `-t "extractIntakeAnswer"` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/interviewer/src/intake-extraction.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): single-field intake answer extractor"
```

---

## Task 7 — Turn loop: deeplink, opener, async per-turn extraction

**Files:**
- Modify: `packages/interviewer/src/turn-loop.ts`
- Modify: `packages/interviewer/test/interviewer.test.ts`

This is the task that makes intake actually collect data.

- [ ] **Step 1: Write failing tests**

```typescript
describe("Turn loop — deeplink + intake extraction", () => {
  function freshAnchors() {
    const a = new InMemoryAnchorSource();
    a.set("p1", { personId: "p1", spokenName: "Eleanor", birthYear: 1943, profile: EMPTY_PROFILE });
    return a;
  }
  it("serves deeplink ask on turn 0 even with prior stories", async () => {
    const memory = new InMemoryMemorySource(); memory.set("p1", PRIOR);
    const asks = new InMemoryAskSource(); asks.set("p1", [{ askId: "dl", askerName: "Marcus", questionText: "?", priority: 1 }]);
    const s = await createInterviewSession(
      { languageModel: new ScriptedLanguageModel([{ text: "Marcus asked...", modelId: "m1" }]),
        voice: new ScriptedVoice(), askSource: asks, memorySource: memory, anchorSource: freshAnchors() },
      { narratorPersonId: "p1", targetAskId: "dl" });
    const t = await s.nextTurn();
    expect(t.intent.kind).toBe("ask");
    expect((t.intent as any).askId).toBe("dl");
  });

  it("after an intake turn, recordResponse extracts + writes the field", async () => {
    const anchors = freshAnchors();
    // First LLM call = phraser (question); second = extractor (returns the value).
    const llm = new ScriptedLanguageModel([
      { text: "Tell me about where you grew up.", modelId: "m1" },
      { text: JSON.stringify({ value: "New Orleans" }), modelId: "m1" },
    ]);
    const s = await createInterviewSession(
      { languageModel: llm, voice: new ScriptedVoice(), askSource: new InMemoryAskSource(),
        memorySource: new InMemoryMemorySource(), anchorSource: anchors },
      { narratorPersonId: "p1" });
    const t = await s.nextTurn();
    expect(t.intent.kind).toBe("intake");
    await s.recordResponse("Oh, I grew up in New Orleans.");
    const updated = await anchors.loadForNarrator("p1");
    expect(updated?.profile.hometown).toBe("New Orleans");
  });

  it("recordResponse after a non-intake turn does not call the extractor", async () => {
    // Only ONE scripted response (the base/intake question). A second LLM call would throw.
    const anchors = freshAnchors();
    // Make intake already complete so turn is base bank.
    anchors.set("p1", { personId: "p1", spokenName: "Eleanor", birthYear: 1943,
      profile: { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null } });
    const llm = new ScriptedLanguageModel([{ text: "Tell me about a childhood meal.", modelId: "m1" }]);
    const s = await createInterviewSession(
      { languageModel: llm, voice: new ScriptedVoice(), askSource: new InMemoryAskSource(),
        memorySource: new InMemoryMemorySource(), anchorSource: anchors },
      { narratorPersonId: "p1" });
    await s.nextTurn();
    await expect(s.recordResponse("It was wonderful.")).resolves.toBeUndefined();
  });
});
```

Run: `-t "Turn loop — deeplink + intake"` → FAIL.

- [ ] **Step 2: Update `turn-loop.ts`**

Add import:
```typescript
import { extractIntakeAnswer } from "./intake-extraction";
import { INTAKE_QUESTIONS } from "./questions/intake";
```

Add `targetAskId?` to options:
```typescript
export interface InterviewSessionOptions {
  narratorPersonId: string;
  /** When set, the session was opened via a notification deeplink for this specific Ask. */
  targetAskId?: string;
}
```

Change the `InterviewSession` interface `recordResponse` return type to async:
```typescript
  recordResponse(utterance: string): Promise<void>;
```

In `createInterviewSession`, add a closure variable to remember a pending intake extraction, set it in `nextTurn`, and consume it in `recordResponse`:

```typescript
  let pendingIntake: { key: keyof typeof EMPTY_KEY; question: (typeof INTAKE_QUESTIONS)[number] } | null = null;
```
Simpler — track the intent's question object directly:
```typescript
  let pendingIntakeKey: import("./behavior").PromptIntent extends never ? never : null | {
    questionKey: Parameters<typeof intakeQuestionByKey>[0];
  };
```
Use this concrete, dependency-free form instead (replace the two sketches above):
```typescript
  let pendingIntakeKey: string | null = null;
```

In `nextTurn`, after computing `intent` and before returning, record the pending key:
```typescript
    const intent = pickNextIntent({ state, pendingAsks, priorStories, anchors, targetAskId: opts.targetAskId });
    if (intent.kind === "intake") pendingIntakeKey = intent.questionKey;
    const phrased = await phraseIntent(deps.languageModel, {
      intent, anchors, priorStories, isFirstSession: priorStories.length === 0,
    });
```
(Leave the rest of `nextTurn` — voice, `recordTurnCompleted`, `markRouted` — unchanged.)

Replace `recordResponse`:
```typescript
  async function recordResponse(utterance: string): Promise<void> {
    ingestNarratorUtterance(state, utterance);
    const key = pendingIntakeKey;
    pendingIntakeKey = null;
    if (!key) return;
    const question = INTAKE_QUESTIONS.find((q) => q.key === key);
    if (!question) return;
    try {
      const value = await extractIntakeAnswer(deps.languageModel, question, utterance);
      if (value !== null && value !== undefined) {
        // value is string | boolean; writeProfileField is generic and accepts the field's type.
        await deps.anchorSource.writeProfileField(state.narratorPersonId, key, value as never);
      }
    } catch (e) {
      // Extraction is best-effort: a failure must not break the session. The field stays null and
      // the question is re-asked next session (askedIntakeKeys only guards within this session).
      // eslint-disable-next-line no-console
      console.warn("intake extraction failed (key=%s):", key, e);
    }
  }
```

Update the returned object's `recordResponse` reference (unchanged name; now async).

Note: the in-memory `anchors` snapshot is intentionally NOT mutated here — consistent with the "stable snapshot at session start" invariant. The written field is visible next session; within this session `askedIntakeKeys` already prevents re-asking.

- [ ] **Step 3: Update existing callers of `recordResponse`**

Any existing test or code calling `session.recordResponse(...)` synchronously now returns a promise. Add `await` where a test depends on ordering. Search:
```bash
pnpm --filter @chronicle/interviewer exec vitest run -t "recordResponse"
```
and update call sites in the test file to `await session.recordResponse(...)`.

- [ ] **Step 4: Run tests + full suite**

Run: `pnpm --filter @chronicle/interviewer exec vitest run -t "Turn loop — deeplink + intake"` → PASS.
Run: `pnpm --filter @chronicle/interviewer test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/interviewer/src/turn-loop.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): deeplink + opener wiring + async per-turn intake extraction"
```

---

## Task 8 — Core adapter: profile mapping + `writeProfileField`

**Files:**
- Modify: `packages/interviewer/src/core-adapters.ts`
- Modify: `packages/interviewer/test/interviewer.test.ts`

- [ ] **Step 1: Write failing integration test (PGlite)**

```typescript
import { sql } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db/testing";
import { createCoreAnchorSource } from "../src/core-adapters";

describe("CoreAnchorSource — writeProfileField", () => {
  it("writes fields to biographical_anchors without overwriting others", async () => {
    const db = await createTestDatabase();
    const personId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO persons (id, display_name, spoken_name, life_status, created_at, updated_at)
      VALUES (${personId}, 'Eleanor', 'Eleanor', 'living', now(), now())`);
    const source = createCoreAnchorSource(db);
    await source.writeProfileField(personId, "hometown", "New Orleans");
    await source.writeProfileField(personId, "hasChildren", true);
    const anchors = await source.loadForNarrator(personId);
    expect(anchors?.profile.hometown).toBe("New Orleans");
    expect(anchors?.profile.hasChildren).toBe(true);
    expect(anchors?.profile.siblingContext).toBeNull();
  });
});
```

Run: `-t "CoreAnchorSource"` → FAIL.

- [ ] **Step 2: Rewrite `createCoreAnchorSource`**

```typescript
import { sql } from "drizzle-orm";
import type { BiographicalProfile } from "@chronicle/db";
// ...existing imports (getNarratorBiographicalContext, Database, contract types)...

export function createCoreAnchorSource(db: Database): AnchorSource {
  return {
    async loadForNarrator(personId: string): Promise<BiographicalAnchors | null> {
      const ctx = await getNarratorBiographicalContext(db, personId);
      if (!ctx) return null;
      const stored = (ctx.anchors ?? {}) as Partial<BiographicalProfile>;
      return {
        personId: ctx.personId,
        spokenName: ctx.spokenName,
        birthYear: ctx.birthYear,
        profile: {
          hometown: stored.hometown ?? null,
          siblingContext: stored.siblingContext ?? null,
          currentLocation: stored.currentLocation ?? null,
          occupationSummary: stored.occupationSummary ?? null,
          hasChildren: stored.hasChildren ?? null,
          hasGrandchildren: stored.hasGrandchildren ?? null,
        },
      };
    },
    async writeProfileField<K extends keyof BiographicalProfile>(
      personId: string, key: K, value: NonNullable<BiographicalProfile[K]>,
    ): Promise<void> {
      // JSONB merge — set ONE key, never touching the others. persons is on the open schema,
      // so this is a non-content write (no story/media bypass).
      await db.execute(sql`
        UPDATE persons
        SET biographical_anchors = COALESCE(biographical_anchors, '{}'::jsonb) || ${sql.raw(`'${JSON.stringify({ [key]: value })}'`)}::jsonb,
            updated_at = now()
        WHERE id = ${personId}`);
    },
  };
}
```

Note on the JSONB literal: building the patch via `sql.raw` with `JSON.stringify` is safe here because `key` is a fixed enum of profile field names and `value` is a model-extracted string/boolean. If the reviewer prefers a bound parameter, use `${JSON.stringify({ [key]: value })}::jsonb` directly (drizzle binds it as text) and confirm the PGlite driver casts text→jsonb; if not, keep the `sql.raw` form. Prefer the bound-parameter form if it works in the PGlite test.

- [ ] **Step 3: Run test** → `-t "CoreAnchorSource"` → PASS. If the bound-parameter cast fails under PGlite, switch to the `sql.raw` form and re-run.

- [ ] **Step 4: Full interviewer suite** → `pnpm --filter @chronicle/interviewer test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/interviewer/src/core-adapters.ts packages/interviewer/test/interviewer.test.ts
git commit -m "feat(interviewer): CoreAnchorSource profile mapping + writeProfileField JSONB merge"
```

---

## Task 9 — Post-approval profile extraction (augmentation)

**Files:**
- Create: `packages/pipeline/src/extract-biography.ts`
- Modify: the pipeline orchestrator that runs after story approval
- Modify: `packages/pipeline/test/*`

Augments the profile from approved story transcripts — never overwriting a directly-answered field.

- [ ] **Step 1: Locate the post-approval orchestration point**

```bash
pnpm --filter @chronicle/pipeline exec ls src/
```
Identify the file sequencing `transcribe → render_story`, and where a story reaches `approved` with a transcript.

- [ ] **Step 2: Write failing test**

```typescript
import { extractBiographicalProfile } from "../src/extract-biography";

describe("extractBiographicalProfile", () => {
  it("extracts mentioned fields, null for the rest", async () => {
    const llm = new ScriptedLanguageModel([{ text: JSON.stringify({
      hometown: "New Orleans", siblingContext: null, currentLocation: null,
      occupationSummary: null, hasChildren: null, hasGrandchildren: null }), modelId: "m1" }]);
    const r = await extractBiographicalProfile("I grew up in New Orleans.", llm);
    expect(r.hometown).toBe("New Orleans");
    expect(r.siblingContext).toBeNull();
  });
  it("returns {} on unparseable output", async () => {
    const llm = new ScriptedLanguageModel([{ text: "oops", modelId: "m1" }]);
    expect(await extractBiographicalProfile("...", llm)).toEqual({});
  });
});
```

Run: `pnpm --filter @chronicle/pipeline exec vitest run -t "extractBiographicalProfile"` → FAIL.

- [ ] **Step 3: Create `packages/pipeline/src/extract-biography.ts`**

```typescript
/**
 * Post-approval biographical extraction. Runs after a story is approved and has a transcript.
 * Returns a Partial<BiographicalProfile> — only fields the LLM could confidently extract. The
 * caller writes only non-null results, and only to fields currently null in the DB (never
 * overwrites a direct intake answer).
 */
import type { LanguageModel } from "./contracts";
import type { BiographicalProfile } from "@chronicle/db";

const SYSTEM_PROMPT = `You extract structured biographical facts from a transcript of someone talking about their life.
Return ONLY raw JSON with exactly these keys: hometown, siblingContext, currentLocation, occupationSummary, hasChildren, hasGrandchildren.
Set any key to null if the fact is absent or uncertain. hometown/siblingContext/currentLocation/occupationSummary are strings or null. hasChildren/hasGrandchildren are booleans or null. No markdown, no prose.`;

const KEYS: Array<keyof BiographicalProfile> = [
  "hometown", "siblingContext", "currentLocation", "occupationSummary", "hasChildren", "hasGrandchildren",
];

export async function extractBiographicalProfile(
  transcript: string, llm: LanguageModel,
): Promise<Partial<BiographicalProfile>> {
  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `TRANSCRIPT:\n${transcript}` },
    ],
    responseFormat: "text", temperature: 0, maxOutputTokens: 300,
  });
  try {
    const parsed = JSON.parse(res.text.trim()) as Record<string, unknown>;
    const safe: Partial<BiographicalProfile> = {};
    for (const k of KEYS) if (k in parsed) (safe as Record<string, unknown>)[k] = parsed[k];
    return safe;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Wire into the post-approval step**

Add, in the post-approval orchestration (using the existing core read for the transcript + the `AnchorSource` adapter from `@chronicle/interviewer`'s `createCoreAnchorSource`):

```typescript
import { extractBiographicalProfile } from "./extract-biography";
import type { BiographicalProfile } from "@chronicle/db";
import type { AnchorSource } from "@chronicle/interviewer";

export async function augmentProfileFromStory(
  transcript: string, ownerPersonId: string, llm: LanguageModel, anchorSource: AnchorSource,
): Promise<void> {
  if (!transcript) return;
  const extracted = await extractBiographicalProfile(transcript, llm);
  const existing = await anchorSource.loadForNarrator(ownerPersonId);
  for (const [k, v] of Object.entries(extracted) as Array<[keyof BiographicalProfile, unknown]>) {
    if (v === null || v === undefined) continue;
    if (existing && existing.profile[k] !== null) continue; // never overwrite a known field
    await anchorSource.writeProfileField(ownerPersonId, k, v as never);
  }
}
```

Call `augmentProfileFromStory` from the approved-story job (where the transcript and `ownerPersonId` are in hand). If `@chronicle/pipeline` should not depend on `@chronicle/interviewer`, inject the `AnchorSource` from the app wiring layer instead and keep `augmentProfileFromStory` parameterized (as written) — do not add a package dependency that the architecture test forbids; verify against `packages/pipeline/test/pipeline.test.ts` SDK/import scan.

- [ ] **Step 5: Run tests** → `pnpm --filter @chronicle/pipeline test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/extract-biography.ts packages/pipeline/src/ packages/pipeline/test/
git commit -m "feat(pipeline): post-approval biographical profile augmentation"
```

---

## Task 10 — Hub intake reminder

**Files:**
- Create: `apps/web/src/app/hub/_components/IntakeReminder.tsx`
- Modify: the hub page that lists user state

- [ ] **Step 1: Create the component**

```tsx
// apps/web/src/app/hub/_components/IntakeReminder.tsx
import Link from "next/link";
import type { BiographicalProfile } from "@chronicle/db";

interface Props { profile: Partial<BiographicalProfile>; }

/** Required for "complete": the four free-text facts + whether they have children.
 *  hasGrandchildren is conditional and never required. */
function isProfileComplete(p: Partial<BiographicalProfile>): boolean {
  return p.hometown != null && p.siblingContext != null && p.currentLocation != null
      && p.occupationSummary != null && p.hasChildren != null;
}

export function IntakeReminder({ profile }: Props) {
  if (isProfileComplete(profile)) return null;
  return (
    <div role="status" aria-label="Finish your introduction">
      <p>Help us get to know you — finishing a few questions about your background makes every session feel more personal.</p>
      <Link href="/record">Continue your introduction</Link>
    </div>
  );
}
```

- [ ] **Step 2: Render in the hub page**

In the hub page server component, read the current Person's `biographicalAnchors` (existing person fetch) and render near the top:
```tsx
<IntakeReminder profile={person.biographicalAnchors ?? {}} />
```
Match the existing hub data-fetch + banner patterns (check sibling components in `apps/web/src/app/hub/`). Pull display copy through the established `_copy/hub` module if banners there already do (the repo recently centralized hub copy — follow that convention rather than inlining the strings if `_copy/hub` exists).

- [ ] **Step 3: Manual verify**

```bash
pnpm --filter @chronicle/web dev
```
Set a test person's `biographical_anchors` to `{}` → reminder shows. Set all five required fields → reminder hidden.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/hub/
git commit -m "feat(web): hub intake reminder until biographical profile complete"
```

---

## Final verification

- [ ] `pnpm -r typecheck` → PASS
- [ ] `pnpm -r test` → PASS
- [ ] `pnpm -r lint` → PASS
- [ ] Re-read `packages/core/test/architecture.test.ts` allowlist: confirm no new file trips the content-table guard. `core-adapters.ts` writes to `persons` (open schema) — not a content table — so it does not need allowlisting. `augmentProfileFromStory` reads the transcript through an existing audited core read; confirm it does not import `@chronicle/db/content`.

---

## Self-review

**Spec coverage:** intake intent (T4), open-ended questions (T3), per-turn extraction — the previously-missing core mechanism (T6+T7), deeplink priority (T4+T7), first-session opener (T5), writeProfileField (T2 contract / T8 impl), post-approval augmentation no-overwrite (T9), hub reminder (T10), typed profile (T1/T2). All covered.

**Ephemeral honored:** No task creates a Story or Media for an intake answer; no capture/ingest path is touched. Keyboard intake needs nothing extra — the web surface feeds `recordResponse(text)` regardless of voice/keyboard origin.

**Type consistency:** `BiographicalProfile` defined once (schema.ts), re-exported via `@chronicle/db` and `contracts.ts`. `intake` `PromptIntent.questionKey: keyof BiographicalProfile` matches `askedIntakeKeys: Set<keyof BiographicalProfile>` and `recordTurnCompleted`. `writeProfileField<K>` signature identical in contract, mock, and core adapter. `extractIntakeAnswer` returns `string | boolean | null`; written via `value as never` against the generic `writeProfileField` (the runtime value already matches the field's type by construction of the question→field mapping).

**Placeholder scan:** the only intentionally open instructions are "match existing hub patterns" (T10) and "locate the post-approval orchestration point" (T9) — both require reading the live tree and are concrete enough to act on.

---

## Deferred — Plan B: text stories (separate plan, NOT in scope here)

Keyboard input for *actual storytelling* (not intake) requires a discriminated `stories.kind` (`voice | text`), a nullable `recording_media_id`, and resolving the `invariants.sql` trigger `chronicle_story_recording_pointer_immutable` (which currently blocks NULL→value, i.e. forbids upgrading a text story with audio later). It also needs a text-story write path in `@chronicle/core` (on the audited allowlist) parallel to `persistRecordingAndCreateDraft`, a capture/ingest branch, and a web capture-surface toggle. This is its own vertical slice with real Phase-0-invariant implications and must be planned and reviewed separately. Decisions already locked for Plan B: discriminated union (not nullable-only); typed text is canonical for text stories; the trigger's NULL→value rule must be explicitly revisited.
