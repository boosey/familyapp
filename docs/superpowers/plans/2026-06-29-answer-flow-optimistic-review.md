# Optimistic Review Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the narrator stops recording, show the review screen immediately — replayable audio plus a "Polishing your words…" spinner over the editor — instead of holding on the record screen until transcribe+render finishes.

**Architecture:** Render stays foregrounded inside the existing `recordAnswerAction` (no backend change). The instant recording stops, the client builds a local object URL from the audio bytes and renders a new presentational `AnswerReviewPending` screen. When the awaited action resolves, one `router.refresh()` makes the `pending_approval` draft prop arrive, which flips the existing `key={draft?.storyId ?? "record"}` and remounts `AnswerFlow` into the review-ready screen (editor seeded from `draft.prose`). No polling, no `after()`, no core/pipeline/DB changes.

**Tech Stack:** Next.js 15 / React 19 client component, Vitest + jsdom + @testing-library/react, Kindred design-system CSS tokens.

**Spec:** `docs/superpowers/specs/2026-06-29-answer-flow-optimistic-review-design.md`

---

## File Structure

- **Modify** `apps/web/app/_copy/hub.ts` — add `polishing`, `polishingSub`, `recordAgain` strings to `hub.answer`.
- **Modify** `apps/web/app/_kindred/tokens.css` — add `@keyframes kindred-spin` + a `.kindred-spinner` class.
- **Create** `apps/web/app/hub/answer/[askId]/AnswerReviewPending.tsx` — presentational review-pending screen (audio + spinner/message, or error + "Record again"). One responsibility: the in-flight review UI. Independently testable.
- **Modify** `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx` — add `localTake`/`pendingError` state, object-URL lifecycle, the `recordAgain` handler, the review-pending render branch, and the `uploadRecording` transition.
- **Modify** `apps/web/__tests__/answer-flow-review-seed.test.tsx` — add presentation tests for `AnswerReviewPending`.
- **Create** `apps/web/__tests__/answer-flow-optimistic-transition.test.tsx` — integration test: stopping a recording shows the review-pending screen (audio + spinner, editor hidden) via a mocked media stack.

`page.tsx` is **unchanged** (the `key` line stays; it keeps surfacing only `pending_approval` drafts).

---

## Task 1: Copy strings + spinner CSS

Static data/CSS — no test. Mechanical additions used by later tasks.

**Files:**
- Modify: `apps/web/app/_copy/hub.ts` (the `answer:` object, ~line 165-182)
- Modify: `apps/web/app/_kindred/tokens.css` (after the `kindred-listening` keyframe, ~line 121)

- [ ] **Step 1: Add copy strings**

In `apps/web/app/_copy/hub.ts`, inside the `answer: { … }` object, add these three keys (place them just after `takeYourTime`):

```ts
    takeYourTime: "Take your time. Long silences are fine.",
    // Optimistic review: shown over the editor slot while transcribe+render runs.
    polishing: "Polishing your words…",
    polishingSub: "Your recording is saved — this just takes a moment.",
    recordAgain: "Record again",
```

- [ ] **Step 2: Add the spinner keyframe + class**

In `apps/web/app/_kindred/tokens.css`, immediately after the `kindred-listening` keyframe block (line 121) and before the `@media (prefers-reduced-motion)` block, add:

```css
@keyframes kindred-spin { to { transform: rotate(360deg); } }
.kindred-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--accent-soft);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: kindred-spin 0.8s linear infinite;
}
```

Then add a reduced-motion rule for it inside the existing `@media (prefers-reduced-motion: reduce)` block:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fade: 0s; --dur-settle: 0s; }
  .kindred-spinner { animation-duration: 1.8s; }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS (no type errors — copy object stays `as const`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/_copy/hub.ts apps/web/app/_kindred/tokens.css
git commit -m "feat(web): copy + spinner CSS for optimistic review screen"
```

---

## Task 2: `AnswerReviewPending` component (TDD)

A presentational screen: given an audio URL, an optional error, a "record again" callback, and a header node, render the in-flight review UI. No state, no media, no server — trivially testable.

**Files:**
- Create: `apps/web/app/hub/answer/[askId]/AnswerReviewPending.tsx`
- Test: `apps/web/__tests__/answer-flow-review-seed.test.tsx` (add a new describe block)

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/__tests__/answer-flow-review-seed.test.tsx` — a new import and a new describe block at the end of the file (keep the existing imports/tests):

```tsx
import { AnswerReviewPending } from "@/app/hub/answer/[askId]/AnswerReviewPending";

describe("AnswerReviewPending presentation", () => {
  it("shows audio + the polishing spinner/message, and NO editor", () => {
    const { container } = render(
      <AnswerReviewPending
        audioUrl="blob:fake-take"
        error={null}
        onRecordAgain={() => {}}
        header={<div>header</div>}
      />,
    );
    // Editor is hidden until prose is ready.
    expect(screen.queryByRole("textbox")).toBeNull();
    // Polishing status is announced and the spinner is present.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/Polishing your words/)).toBeTruthy();
    expect(container.querySelector(".kindred-spinner")).not.toBeNull();
    // The recording is replayable (one <audio> with the local URL).
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("blob:fake-take");
  });

  it("shows an error + 'Record again' button (no spinner) when render failed", () => {
    const onRecordAgain = vi.fn();
    const { container } = render(
      <AnswerReviewPending
        audioUrl="blob:fake-take"
        error="Could not save your recording. Please try again."
        onRecordAgain={onRecordAgain}
        header={<div>header</div>}
      />,
    );
    expect(container.querySelector(".kindred-spinner")).toBeNull();
    expect(screen.getByText(/Could not save your recording/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Record again/ });
    btn.click();
    expect(onRecordAgain).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/answer-flow-review-seed.test.tsx`
Expected: FAIL — `Failed to resolve import "@/app/hub/answer/[askId]/AnswerReviewPending"` (file does not exist yet).

- [ ] **Step 3: Implement `AnswerReviewPending`**

Create `apps/web/app/hub/answer/[askId]/AnswerReviewPending.tsx`:

```tsx
"use client";

/**
 * Review-pending screen — shown the instant recording stops, while transcribe+render runs in
 * the foreground (awaited by AnswerFlow.uploadRecording). The narrator can replay their take
 * immediately; a spinner + "Polishing your words…" sits over the editor's slot until the prose
 * is ready. When render resolves, AnswerFlow's router.refresh() makes the draft prop arrive and
 * the key remount swaps this screen for the review-ready editor.
 *
 * Purely presentational: AnswerFlow owns the audio object URL, the error, and the retry.
 */
import type { ReactNode } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";

export interface AnswerReviewPendingProps {
  audioUrl: string;
  error: string | null;
  onRecordAgain: () => void;
  header: ReactNode;
}

export function AnswerReviewPending({
  audioUrl,
  error,
  onRecordAgain,
  header,
}: AnswerReviewPendingProps) {
  return (
    <div>
      {header}

      {/* Relisten the take they just gave (local object URL). */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        src={audioUrl}
        style={{
          width: "100%",
          maxWidth: 480,
          display: "block",
          margin: "0 auto 32px",
          borderRadius: "var(--radius-md)",
        }}
      />

      {error ? (
        <div style={{ textAlign: "center" }}>
          <p
            aria-live="polite"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-danger, #b00)",
              margin: "0 0 16px",
            }}
          >
            {error}
          </p>
          <KindredButton
            label={hub.answer.recordAgain}
            variant="secondary"
            size="small"
            onClick={onRecordAgain}
          />
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "32px 0",
            textAlign: "center",
          }}
        >
          <div className="kindred-spinner" aria-hidden="true" />
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "clamp(1.25rem, 3.5vw, 28px)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.answer.polishing}
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              margin: 0,
            }}
          >
            {hub.answer.polishingSub}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/answer-flow-review-seed.test.tsx`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/AnswerReviewPending.tsx apps/web/__tests__/answer-flow-review-seed.test.tsx
git commit -m "feat(web): AnswerReviewPending screen for the optimistic review flow"
```

---

## Task 3: Integration test for the stop→pending transition (failing first)

Drives the real component through a mocked media stack: start recording, stop, and assert the review-pending screen appears (audio with the local URL + spinner, editor hidden) — before any draft prop arrives.

**Files:**
- Create: `apps/web/__tests__/answer-flow-optimistic-transition.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `apps/web/__tests__/answer-flow-optimistic-transition.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Integration test: stopping a recording immediately shows the review-pending screen (audio +
 * "Polishing your words…" spinner, editor hidden) while recordAnswerAction is still in flight.
 * Mocks the browser media stack (getUserMedia, MediaRecorder, object URLs) and the server action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnswerFlow } from "@/app/hub/answer/[askId]/AnswerFlow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {} }),
}));

// A controllable record action: resolves only when we call `resolveRecord`, so the test can
// assert the pending screen WHILE the action is still awaiting.
let resolveRecord: (v: { error: string } | undefined) => void;
const recordAnswerAction = vi.fn(
  () => new Promise<{ error: string } | undefined>((res) => (resolveRecord = res)),
);
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  recordAnswerAction: (...args: unknown[]) => recordAnswerAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
}));

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state = "inactive";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public stream: any) {}
  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  URL.createObjectURL = vi.fn(() => "blob:local-take");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnswerFlow optimistic transition", () => {
  it("shows the review-pending screen the moment recording stops", async () => {
    render(
      <AnswerFlow
        askId="11834dd1-04f4-44a4-b611-24fdd9c3d8fd"
        questionText="What have you learned about being a grandparent?"
        askerName="Sam"
        draft={null}
      />,
    );

    // Start: click the voice button (idle → listening, async getUserMedia).
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());

    // Stop: click again → MediaRecorder.stop() → onstop → uploadRecording → localTake set.
    fireEvent.click(screen.getByRole("button"));

    // Review-pending appears while recordAnswerAction is still pending.
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());
    expect(recordAnswerAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull(); // editor hidden
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("blob:local-take");

    // On success the client refreshes (the keyed remount to review-ready is covered elsewhere).
    resolveRecord(undefined);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/answer-flow-optimistic-transition.test.tsx`
Expected: FAIL — the current `AnswerFlow` shows the "saving" voice button (no "Polishing your words…" text, no local-take `<audio>`) after stop, so the `waitFor` times out.

---

## Task 4: Wire the optimistic transition into `AnswerFlow` (make Task 3 pass)

**Files:**
- Modify: `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx`

- [ ] **Step 1: Add the import**

Add to the existing import block (after the `KindredVoiceButton…` import at line 16):

```tsx
import { AnswerReviewPending } from "./AnswerReviewPending";
```

Also add `useEffect` to the React import at line 14:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
```

- [ ] **Step 2: Add state + object-URL lifecycle + recordAgain**

In the "Review phase state" block (after line 64, `const [proseDraft, setProseDraft] = useState(draft?.prose ?? "");`), add:

```tsx
  // ── Optimistic review-pending state ─────────────────────────────────────────
  // Set the instant recording stops: a local object URL of the take, shown (with a polishing
  // spinner) while recordAnswerAction runs. Discarded when the draft prop arrives (keyed remount).
  const [localTake, setLocalTake] = useState<{ url: string } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Revoke the object URL when localTake changes or the component unmounts (the remount into
  // review-ready unmounts this instance), so we don't leak blob URLs.
  useEffect(() => {
    if (!localTake) return;
    return () => URL.revokeObjectURL(localTake.url);
  }, [localTake]);

  const recordAgain = useCallback(() => {
    setPendingError(null);
    setLocalTake(null); // triggers the effect cleanup above → revokes the URL
    setRecordPhase("idle");
  }, []);
```

- [ ] **Step 3: Rewrite `uploadRecording` to transition optimistically**

Replace the existing `uploadRecording` (lines 67-84) with:

```tsx
  const uploadRecording = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      // Show the review screen immediately, playing the take from a local object URL, while the
      // pipeline (transcribe + render) runs server-side below.
      setPendingError(null);
      setLocalTake({ url: URL.createObjectURL(blob) });

      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      form.append("askId", askId);
      const result = await recordAnswerAction(form);
      if (result?.error) {
        // Stay on the review-pending screen and surface the error with a "Record again" retry.
        setPendingError(result.error);
      } else {
        // Render is done; pull the pending_approval draft (with prose) through the server read.
        // The arriving draft prop flips the page key → remount into review-ready.
        router.refresh();
      }
    } catch {
      setPendingError(hub.answer.genericError);
    }
  }, [askId, router]);
```

- [ ] **Step 4: Add the review-pending render branch**

Immediately AFTER the `if (draft) { … }` review-ready block closes (after line 450, the `}` that ends the `if (draft)` block) and BEFORE the `// ── RECORD PHASE ──` comment (line 452), insert:

```tsx
  // ── REVIEW-PENDING PHASE ────────────────────────────────────────────────────
  // Recorded locally; render is in flight (or failed). Shown until the draft prop arrives.
  if (localTake) {
    return (
      <AnswerReviewPending
        audioUrl={localTake.url}
        error={pendingError}
        onRecordAgain={recordAgain}
        header={questionHeader}
      />
    );
  }
```

(Note: the `if (draft)` branch stays FIRST, so once the real draft prop arrives the review-ready screen wins even though this instance is being torn down by the remount.)

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/answer-flow-optimistic-transition.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/AnswerFlow.tsx apps/web/__tests__/answer-flow-optimistic-transition.test.tsx
git commit -m "feat(web): show review screen immediately after recording (optimistic review)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole web suite**

Run: `pnpm --filter @chronicle/web test`
Expected: PASS — all files green (existing 41 + the new pending/transition tests).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web lint`
Expected: PASS (no type errors; lint clean — the two `eslint-disable` comments cover the `<audio>` caption rule and the one `any` in the test).

- [ ] **Step 3: Manual live check (record a real answer)**

Start the dev server (`pnpm --filter @chronicle/web dev`), record an answer, and confirm: the review screen appears immediately with the take replayable and a "Polishing your words…" spinner over the editor; a moment later the prose drops in and the tier picker + Share appear. Then test the re-record path from the ready screen (buttons not stuck disabled).

---

## Self-Review notes

- **Spec coverage:** optimistic review screen (Tasks 2,4) ✓; local audio playback (Task 2 audio + Task 4 object URL) ✓; spinner + message over editor (Tasks 1,2) ✓; tier/Share hidden until ready (the pending screen simply doesn't render them — Task 2) ✓; single `router.refresh()` transition + keyed remount (Task 4; remount seeding already guarded by the existing test) ✓; error → "Record again" without re-ingest ambiguity (Tasks 2,4) ✓; no backend/core/pipeline change ✓.
- **Deferred (per spec):** streaming prose; the orphan-draft-on-render-failure wart (unchanged from today).
- **Names used consistently:** `localTake`, `pendingError`, `recordAgain`, `AnswerReviewPending`, `hub.answer.polishing` / `polishingSub` / `recordAgain`, `.kindred-spinner` — all defined in earlier tasks before use.
