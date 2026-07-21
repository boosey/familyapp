# ADR-0014 Inc 1 — Pipeline Seams (`cleanupTake` + `deriveMetadata`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two pure LM seam functions ADR-0014 §5 freezes — `cleanupTake` (per-take automatic Cleanup) and `deriveMetadata` (title/summary/tags at Finish) — to `@chronicle/pipeline`, with unit tests. Nothing is wired yet; Inc 3 composes these into the capture/Finish actions.

**Architecture:** Two new pure functions, each in its own file, mirroring the existing `render-story.ts` / `polish-prose.ts` shape (in-house system prompt + `buildMessages` + a thin `llm.complete` wrapper; behavior policy lives in our code, the vendor only sees assembled messages). `deriveMetadata` reuses the already-exported `parseRenderResponse` from `render-story.ts` (discarding its `prose`) so JSON-parse/fallback/caps stay DRY and `render-story.ts` is **not** modified. The monolithic `renderStoryFromTranscript` and the old orchestrator/multi-take render path **stay in place** — Inc 3 retires them. This increment is purely additive.

**Tech Stack:** TypeScript (strict ESM), Vitest, `@chronicle/pipeline` (`ScriptedLanguageModel` mock, `LanguageModel` contract). No vendor SDKs (architecture test forbids them in IP code).

**Frozen contract (do not renegotiate — ADR-0014 §5 in `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md`):**
```ts
cleanupTake(llm: LanguageModel, input: {
  transcript: string; promptQuestion?: string; narratorSpokenName?: string;
}): Promise<{ prose: string; modelId: string; systemPrompt: string }>

deriveMetadata(llm: LanguageModel, input: {
  fullText: string; promptQuestion?: string; narratorSpokenName?: string;
}): Promise<{ title: string; summary: string; tags: string[]; modelId: string; systemPrompt: string }>
```
Behavior constraints from the contract + ADR-0014 §2/§3:
- `cleanupTake` — AUTOMATIC light pass over ONE take's raw transcript: filler/false-starts/accidental-repetition + **within-take** self-corrections; order-preserving; **never reorders/de-rambles** (that is the manual holistic Polish); keeps a genuine hedge when the resolved value is unclear; never sees other takes; never invents facts. Plain-text output. **Empty/whitespace transcript → empty-prose no-op, no LLM call.** A non-empty transcript that yields empty model output **falls back to the raw transcript** (Cleanup never deletes a take's words).
- `deriveMetadata` — title/summary/tags **only**, over the whole final composed text. **No prose. No `eraYear`** (deferred). Reuses the metadata half of the render prompt.

---

## File Structure

- Create `packages/pipeline/src/cleanup-take.ts` — `CLEANUP_SYSTEM_PROMPT`, `CleanupTakeInput`, `CleanupTakeOutput`, `cleanupTake`.
- Create `packages/pipeline/src/derive-metadata.ts` — `METADATA_SYSTEM_PROMPT`, `DeriveMetadataInput`, `DeriveMetadataOutput`, `deriveMetadata` (imports `parseRenderResponse` from `./render-story`).
- Create `packages/pipeline/test/cleanup-take.test.ts`.
- Create `packages/pipeline/test/derive-metadata.test.ts`.
- Modify `packages/pipeline/src/index.ts` — export both new functions + their types.

Reference files (read, do not modify): `packages/pipeline/src/render-story.ts` (prompt/parse pattern + `parseRenderResponse`), `packages/pipeline/src/polish-prose.ts` (empty no-op + plain-text pattern), `packages/pipeline/src/contracts.ts` (`LanguageModel`), `packages/pipeline/src/mocks.ts` (`ScriptedLanguageModel`), `packages/pipeline/src/constants.ts` (`STORY_RENDER_LLM_TEMPERATURE`, `STORY_RENDER_MAX_OUTPUT_TOKENS`).

Run all pipeline tests with: `pnpm --filter @chronicle/pipeline test`
Run a single test file with: `pnpm --filter @chronicle/pipeline test cleanup-take`

---

## Task 1: `cleanupTake` — the per-take Cleanup seam

**Files:**
- Create: `packages/pipeline/src/cleanup-take.ts`
- Test: `packages/pipeline/test/cleanup-take.test.ts`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/test/cleanup-take.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { cleanupTake, CLEANUP_SYSTEM_PROMPT } from "../src/cleanup-take";

describe("cleanupTake", () => {
  it("empty/whitespace transcript is a no-op: no LLM call, empty prose", async () => {
    const llm = new ScriptedLanguageModel();
    const out = await cleanupTake(llm, { transcript: "   \n  " });
    expect(llm.calls).toHaveLength(0);
    expect(out.prose).toBe("");
    expect(out.modelId).toBe("");
    expect(out.systemPrompt).toBe(CLEANUP_SYSTEM_PROMPT);
  });

  it("returns the model's cleaned text as prose, with provenance", async () => {
    const llm = new ScriptedLanguageModel({ respond: "I was born on a farm.", modelId: "mock-cleanup" });
    const out = await cleanupTake(llm, { transcript: "uh I was, I was born on a farm you know" });
    expect(llm.calls).toHaveLength(1);
    expect(out.prose).toBe("I was born on a farm.");
    expect(out.modelId).toBe("mock-cleanup");
    // Provenance: the system prompt we report is the one the model actually saw.
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
    expect(out.systemPrompt).toBe(CLEANUP_SYSTEM_PROMPT);
  });

  it("requests plain-text (not JSON) output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "clean text" });
    await cleanupTake(llm, { transcript: "some words" });
    expect(llm.calls[0]!.responseFormat).toBe("text");
  });

  it("empty model output falls back to the raw transcript — Cleanup never deletes a take", async () => {
    const llm = new ScriptedLanguageModel({ respond: "   " });
    const out = await cleanupTake(llm, { transcript: "  my exact words  " });
    expect(out.prose).toBe("my exact words");
  });

  it("includes promptQuestion and narratorSpokenName in the user message when provided", async () => {
    const llm = new ScriptedLanguageModel({ respond: "ok" });
    await cleanupTake(llm, {
      transcript: "we moved a lot",
      promptQuestion: "Where did you grow up?",
      narratorSpokenName: "Rosa",
    });
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Rosa");
    expect(userMsg).toContain("Where did you grow up?");
    expect(userMsg).toContain("we moved a lot");
  });

  it("the Cleanup prompt is distinct from the holistic Polish prompt and forbids reordering", async () => {
    // Guards the pass-scope invariant: Cleanup is single-take + order-preserving; de-ramble/reorder
    // belongs to the manual Polish. If someone pastes the Polish prompt in here, this fails.
    const { POLISH_SYSTEM_PROMPT } = await import("../src/polish-prose");
    expect(CLEANUP_SYSTEM_PROMPT).not.toBe(POLISH_SYSTEM_PROMPT);
    expect(CLEANUP_SYSTEM_PROMPT.toLowerCase()).toContain("reorder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/pipeline test cleanup-take`
Expected: FAIL — `Cannot find module '../src/cleanup-take'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/pipeline/src/cleanup-take.ts`:

```ts
/**
 * Per-take CLEANUP — the AUTOMATIC light pass over ONE freshly-transcribed voice take (ADR-0014 §2).
 *
 * This is the lighter sibling of `polishProse` (the manual, holistic ✨ Polish). Cleanup sees exactly
 * one take, never reorders, and only tidies within-take disfluency + within-take self-corrections.
 * De-rambling and cross-take corrections are the human-confirmed Polish's job — never Cleanup's — so
 * appending a new take can never silently rewrite earlier words (the pass-scope invariant).
 *
 * Output is plain text (the cleaned take only). An empty/whitespace transcript is a no-op that never
 * reaches the LLM (empty prose out). A non-empty take whose model output is empty falls back to the
 * raw transcript — Cleanup never deletes a take's words.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  STORY_RENDER_LLM_TEMPERATURE,
  STORY_RENDER_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface CleanupTakeInput {
  /** ONE take's raw speech-to-text. Never a stitched multi-take transcript. */
  transcript: string;
  /** The question that prompted the telling, if any — framing only, never a source of new facts. */
  promptQuestion?: string | null;
  /** The narrator's spoken name, so the model keeps first-person voice consistent. */
  narratorSpokenName?: string;
}

export interface CleanupTakeOutput {
  /** The cleaned take. Empty string when the input was empty/whitespace (a no-op). */
  prose: string;
  /** The model that produced the cleanup (empty string on the no-op path — no model was called). */
  modelId: string;
  /** The exact system prompt used, recorded as `ai_cleaned` provenance. */
  systemPrompt: string;
}

export const CLEANUP_SYSTEM_PROMPT = `You are a careful oral-history editor preparing ONE spoken take
for a family member to read. This is the light, automatic cleanup pass — NOT a rewrite, and NOT the
stronger "Polish" pass.

You are given the raw speech-to-text of a SINGLE take. You never see any other take; do not assume
any context before or after this text.

WHAT YOU SHOULD DO:
- Remove obvious filler ("uh", "um", "you know"), false starts, and accidental repetition.
- Join broken-up sentences into coherent ones when the speaker's intent is clear.
- Resolve a WITHIN-TAKE self-correction: when the speaker corrects themselves inside this same take
  ("he was born in 1985 — oh wait, no, 1987"), keep ONLY the corrected version and drop the false
  start and the scaffolding ("oh wait", "no", "actually", "I mean"). If it is genuinely unclear which
  value they settled on, KEEP their own hedge rather than guessing.

WHAT YOU MUST NOT DO:
- Do NOT reorder, restructure, or de-ramble. Preserve the order in which things were said. Making
  rambling passages flow is the separate, human-confirmed Polish pass — it is NOT your job.
- Do NOT add facts, dates, names, places, feelings, or details that are not in this take. If the
  speaker is vague, stay vague — that is correct.
- Do NOT change the speaker's emotional register, soften difficult content, or moralize.
- Do NOT narrate ABOUT the speaker. Keep their first-person voice, their own words, and their idiom.

Return ONLY the cleaned text of this take as plain text. No preamble, no quotation marks around it,
no notes.`;

function buildMessages(input: CleanupTakeInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Take transcript (verbatim, from speech-to-text):\n"""\n${input.transcript}\n"""`;
  return [
    { role: "system", content: CLEANUP_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export async function cleanupTake(
  llm: LanguageModel,
  input: CleanupTakeInput,
): Promise<CleanupTakeOutput> {
  const raw = input.transcript.trim();
  if (raw.length === 0) {
    return { prose: "", modelId: "", systemPrompt: CLEANUP_SYSTEM_PROMPT };
  }
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "text",
    temperature: STORY_RENDER_LLM_TEMPERATURE,
    maxOutputTokens: STORY_RENDER_MAX_OUTPUT_TOKENS,
  });
  const cleaned = res.text.trim();
  return {
    // Never delete the take: an empty model response falls back to the raw transcript.
    prose: cleaned.length > 0 ? cleaned : raw,
    modelId: res.modelId,
    systemPrompt: CLEANUP_SYSTEM_PROMPT,
  };
}
```

- [ ] **Step 4: Add the export**

In `packages/pipeline/src/index.ts`, after the `polishProse` export block (around line 87), add:

```ts
export {
  cleanupTake,
  CLEANUP_SYSTEM_PROMPT,
  type CleanupTakeInput,
  type CleanupTakeOutput,
} from "./cleanup-take";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/pipeline test cleanup-take`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/cleanup-take.ts packages/pipeline/test/cleanup-take.test.ts packages/pipeline/src/index.ts
git commit -m "feat(pipeline): cleanupTake — per-take automatic Cleanup seam (ADR-0014 Inc 1 §5)"
```

---

## Task 2: `deriveMetadata` — the Finish-time metadata seam

**Files:**
- Create: `packages/pipeline/src/derive-metadata.ts`
- Test: `packages/pipeline/test/derive-metadata.test.ts`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/test/derive-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { deriveMetadata, METADATA_SYSTEM_PROMPT } from "../src/derive-metadata";

describe("deriveMetadata", () => {
  it("returns title/summary/tags from a JSON response, with provenance", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({
        title: "The Farm",
        summary: "How I grew up on a dairy farm.",
        tags: ["farm", "childhood"],
      }),
      modelId: "mock-meta",
    });
    const out = await deriveMetadata(llm, { fullText: "I grew up on a dairy farm in Ohio." });
    expect(out.title).toBe("The Farm");
    expect(out.summary).toBe("How I grew up on a dairy farm.");
    expect(out.tags).toEqual(["farm", "childhood"]);
    expect(out.modelId).toBe("mock-meta");
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
    expect(out.systemPrompt).toBe(METADATA_SYSTEM_PROMPT);
  });

  it("does not derive prose or era (title/summary/tags only)", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: "T", summary: "S", tags: [], prose: "SHOULD BE IGNORED", eraYear: 1950 }),
    });
    const out = await deriveMetadata(llm, { fullText: "text" });
    // The output type has no prose/eraYear fields; assert we only surfaced metadata.
    expect(Object.keys(out).sort()).toEqual(["modelId", "summary", "systemPrompt", "tags", "title"]);
  });

  it("falls back defensively when the model returns plain text (not JSON)", async () => {
    const llm = new ScriptedLanguageModel({ respond: "The day the barn burned down. It was 1961." });
    const out = await deriveMetadata(llm, { fullText: "The day the barn burned down. It was 1961." });
    expect(out.title).toBe("The day the barn burned down");
    expect(out.tags).toEqual([]);
  });

  it("caps an over-long title (reuses the render parser's caps)", async () => {
    const longTitle = "x".repeat(500);
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: longTitle, summary: "s", tags: [] }),
    });
    const out = await deriveMetadata(llm, { fullText: "some story" });
    expect(out.title.length).toBeLessThan(longTitle.length);
  });

  it("includes promptQuestion and narratorSpokenName in the user message when provided", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ title: "T", summary: "S", tags: [] }) });
    await deriveMetadata(llm, {
      fullText: "we moved a lot",
      promptQuestion: "Where did you grow up?",
      narratorSpokenName: "Rosa",
    });
    const userMsg = llm.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Rosa");
    expect(userMsg).toContain("Where did you grow up?");
    expect(userMsg).toContain("we moved a lot");
  });

  it("requests JSON output", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ title: "T", summary: "S", tags: [] }) });
    await deriveMetadata(llm, { fullText: "text" });
    expect(llm.calls[0]!.responseFormat).toBe("json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/pipeline test derive-metadata`
Expected: FAIL — `Cannot find module '../src/derive-metadata'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/pipeline/src/derive-metadata.ts`:

```ts
/**
 * FINISH-TIME METADATA derivation (ADR-0014 §5). One short LM call over the WHOLE final composed text
 * that returns title/summary/tags only — NO prose (the prose is authored, never regenerated, §7) and
 * NO eraYear (deferred inference; v1 uses a supplied era). Runs synchronously in the Finish action;
 * the durable queue is reserved for background work.
 *
 * The JSON parse + fallbacks + length/count caps are shared with the legacy render path via
 * `parseRenderResponse` (we ask for {title, summary, tags}; its `prose` is ignored). This keeps one
 * parser and one set of caps, and leaves `render-story.ts` untouched for the old flow Inc 3 retires.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  STORY_RENDER_LLM_TEMPERATURE,
  STORY_RENDER_MAX_OUTPUT_TOKENS,
} from "./constants";
import { parseRenderResponse } from "./render-story";

export interface DeriveMetadataInput {
  /** The whole final composed prose (all takes + edits), as sealed at Finish. */
  fullText: string;
  /** The question that prompted the telling, if any — framing only. */
  promptQuestion?: string | null;
  /** The narrator's spoken name, for faithful titling. */
  narratorSpokenName?: string;
}

export interface DeriveMetadataOutput {
  title: string;
  summary: string;
  tags: string[];
  modelId: string;
  /** The exact system prompt used, for provenance/eval. */
  systemPrompt: string;
}

export const METADATA_SYSTEM_PROMPT = `You are a careful oral-history archivist. You are given the
FINAL written text of a family member's story (already cleaned and edited — do not change it). Produce
only catalog metadata for it, drawn strictly FROM the text.

ABSOLUTE RULES:
- Do NOT rewrite, summarize away, or alter the story text. You only produce metadata.
- Draw the title, summary, and tags ONLY from what the text actually says. Do NOT add facts, names,
  dates, places, or themes that are not present. If the text is vague, the metadata is vague.
- Keep the speaker's own words and register where possible; a title in their own phrase is best.

Return STRICT JSON with exactly these fields:
  title:   a short title in the speaker's own words where possible (string, <= 80 chars)
  summary: one faithful sentence (string, <= 200 chars)
  tags:    a short array of theme/entity tags drawn FROM the text (string[], <= 8)

Return ONLY the JSON object. No prose around it.`;

function buildMessages(input: DeriveMetadataInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Final story text:\n"""\n${input.fullText}\n"""`;
  return [
    { role: "system", content: METADATA_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export async function deriveMetadata(
  llm: LanguageModel,
  input: DeriveMetadataInput,
): Promise<DeriveMetadataOutput> {
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "json",
    temperature: STORY_RENDER_LLM_TEMPERATURE,
    maxOutputTokens: STORY_RENDER_MAX_OUTPUT_TOKENS,
  });
  // Reuse the render parser's JSON/plain-text tolerance + caps; discard its `prose`.
  const { title, summary, tags } = parseRenderResponse(res.text, input.fullText);
  return { title, summary, tags, modelId: res.modelId, systemPrompt: METADATA_SYSTEM_PROMPT };
}
```

- [ ] **Step 4: Add the export**

In `packages/pipeline/src/index.ts`, after the `cleanupTake` export block from Task 1, add:

```ts
export {
  deriveMetadata,
  METADATA_SYSTEM_PROMPT,
  type DeriveMetadataInput,
  type DeriveMetadataOutput,
} from "./derive-metadata";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/pipeline test derive-metadata`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/derive-metadata.ts packages/pipeline/test/derive-metadata.test.ts packages/pipeline/src/index.ts
git commit -m "feat(pipeline): deriveMetadata — Finish-time title/summary/tags seam (ADR-0014 Inc 1 §5)"
```

---

## Task 3: Whole-package green + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Run the full pipeline test suite**

Run: `pnpm --filter @chronicle/pipeline test`
Expected: PASS — all prior tests (58 at baseline) plus the 12 new ones. No regressions.

- [ ] **Step 2: Typecheck the pipeline package**

Run: `pnpm --filter @chronicle/pipeline typecheck`
Expected: PASS (no errors). Confirms the new exports and types are sound.

- [ ] **Step 3: Confirm the vendor-SDK architecture test still passes**

The suite includes `pipeline — no vendor SDK imports leak into IP code`. The two new files import only `./contracts`, `./constants`, and `./render-story` — all IP. Confirm that test is green in Step 1's output (it is part of the pipeline suite). No separate command needed.

---

## Self-Review (spec → task)

| Frozen-contract requirement (§5) | Task |
|---|---|
| `cleanupTake` signature + provenance (`modelId`, `systemPrompt`) | Task 1 |
| Cleanup = single-take, order-preserving, within-take self-corrections, no reorder | Task 1 (prompt + reorder-guard test) |
| Empty transcript → empty-prose no-op, no LLM call | Task 1 (test 1) |
| Non-empty take, empty model output → fall back to raw transcript | Task 1 (test 4) |
| `deriveMetadata` signature + provenance | Task 2 |
| title/summary/tags only; no prose; no eraYear | Task 2 (test 2) |
| Defensive parse + caps reused from render path | Task 2 (tests 3–4, via `parseRenderResponse`) |
| Both are pure functions, persist nothing, mockable via `ScriptedLanguageModel` | Tasks 1–2 (all tests use the mock) |
| No vendor SDK in IP code | Task 3 (arch test) |
| `renderStoryFromTranscript` / old render path untouched | (no task modifies `render-story.ts`) |

**Placeholder scan:** none — every step contains full code or an exact command.

**Type consistency:** `CleanupTakeInput/Output`, `DeriveMetadataInput/Output` names are used identically in src, tests, and exports. `deriveMetadata` consumes `parseRenderResponse(text, fallbackProse)` — the exact exported signature in `render-story.ts:106`.

## Out of scope (later increments)
- Wiring `cleanupTake` into the capture action + `deriveMetadata` into the Finish action — **Inc 3** (§6).
- Retiring `renderStoryFromTranscript` and the monolithic `render_story` orchestrator stage — **Inc 3**.
- The Finish-check (detect unresolved cross-take self-corrections and offer a Polish) — **Inc 3**.
- Any schema/DB/core change — done in **Inc 2** (already landed).
