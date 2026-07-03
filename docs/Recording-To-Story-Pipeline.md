# Recording → Story Pipeline

> ⚠️ **A redesign is approved but not yet built (ADR-0014, 2026-07-03).** This document describes the
> **current shipped** flow, where `transcribe` + `render` run automatically on stop and the editor is
> a post-render `pending_approval` review. **ADR-0014 supersedes that**: the editor becomes a live
> `DRAFT` composing surface (record *or type*, per-take **Cleanup**, append, hand-edit, opt-in
> **Polish**), an explicit **Finish** derives metadata and moves to `pending_approval`, and consent
> stays a separate tap. It also reframes prose as *authored* (not regenerable from audio) and renames
> the `ai_polished` provenance level to `ai_cleaned`. For the target design see
> **`docs/Capture-State-Machines.md`** and **`docs/adr/0014-*`**. Until that lands, the flow below is
> what the code does.

How a spoken answer becomes a shared story. Two coupled flows:

- The **interviewer turn loop** (`@chronicle/interviewer`) drives *what the narrator is asked*. It never touches Story state — it only produces the question and consumes the answer's effect on biographical anchors.
- The **recording → story pipeline** (`@chronicle/capture` → `@chronicle/pipeline` → `@chronicle/core`) turns the recorded answer into a transcribed, rendered, consented, shared story.

> Source of truth is the code, not this doc. Key files: `interviewer/turn-loop.ts`, `interviewer/behavior.ts`, `capture/capture.ts`, `pipeline/orchestrator.ts`, `core/story-repository.ts`, `core/authorization.ts`. See also `docs/Phase-0-1-Engineering-Spec.md` and `docs/DECISIONS.md`.

---

## High-altitude view

```mermaid
flowchart LR
    Q["🎙️ Interviewer asks<br/>(turn loop)"] --> A["Narrator answers<br/>(audio)"]
    A --> ING["Ingest<br/>storage-first → DRAFT story"]
    ING --> TR["Transcribe<br/>(Groq Whisper)"]
    TR --> RE["Render story<br/>(Claude) → PENDING_APPROVAL"]
    RE --> AP{"Approve & share<br/>consent gate"}
    AP -->|voice or tap| SH["SHARED story<br/>+ consent record"]
    SH -.->|enriches anchors| Q

    classDef gate fill:#fde2e2,stroke:#c0392b,color:#000;
    class AP gate;
```

The single load-bearing rule: `pending_approval → shared` is the **only** path to a visible story, it runs through `assertStoryTransition`, and it writes one immutable row to the append-only consent ledger. Canonical audio is durable before any DB row exists and is never mutated once consented.

---

## Detailed view

```mermaid
flowchart TD
    subgraph INT["🎙️ Interviewer Turn Loop — @chronicle/interviewer/turn-loop.ts"]
        direction TB
        START(["createInterviewSession(deps, opts)"])
        SNAP["One-time snapshot:<br/>memorySource.recentStoriesForNarrator()<br/>anchorSource.loadForNarrator()<br/>askSource.pendingForNarrator()"]
        PICK{"pickNextIntent() — behavior.ts<br/>priority ladder"}
        P0["P0: distress / off-ramp → wind_down"]
        P1["P1: deeplink targetAskId → ask"]
        P2["P2: turn 0 + prior stories → callback"]
        P3["P3: intake field null → intake"]
        P4["P4: pending Asks → ask"]
        P5["P5: follow-up ≥12 words"]
        P6["P6: base bank<br/>(high sensitivity only after<br/>RAPPORT_THRESHOLD=4 turns)"]
        PHRASE["phraseIntent(LLM) — phraser.ts<br/>Intent → spokenText<br/>persona + anchor context<br/>'one open-ended question'"]
        SPEAK["voice.speak() → ElevenLabs<br/>audio bytes"]
        BOOK["recordTurnCompleted() + askSource.markRouted()"]
        HEAR(["Narrator HEARS question"])
        RESP["recordResponse(utterance)<br/>detectDistress / detectOffRamp → sets P0 flags<br/>extractIntakeAnswer(LLM) → writeProfileField()"]
        WIND{"intent == wind_down?"}

        START --> SNAP --> PICK
        PICK -.-> P0 & P1 & P2 & P3 & P4 & P5 & P6
        PICK --> PHRASE --> SPEAK --> BOOK --> HEAR --> RESP --> WIND
        WIND -- "no" --> PICK
    end

    WIND -- "answer recorded as audio Blob<br/>POST /api/capture" --> S0

    subgraph PIPE["📼 Recording → Story Pipeline"]
        direction TB

        S0["STAGE 0 · resolveCaptureActor() — capture/sessions.ts<br/>link_session: resolveLinkSession(token) | account: Clerk personId<br/>→ { personId }"]

        subgraph S1["STAGE 1 · INGEST (storage-first) — capture/capture.ts"]
            direction TB
            PUT["① storage.put('story-audio/{pid}/{uuid}')<br/>DURABILITY BARRIER — overwrite-rejecting, canonical immutable"]
            DRAFT["② persistRecordingAndCreateDraft() [1 tx] — core/story-repository.ts<br/>insert media kind=story_audio (immutable trigger)<br/>insert story state=DRAFT, tier=private"]
            PUT --> DRAFT
        end

        subgraph S2["STAGE 2 · RENDER PIPELINE — pipeline/orchestrator.ts (JobQueue: in-proc / Inngest)"]
            direction TB
            T["2A runTranscribeStage [idempotent]<br/>storage.getBytes(canonical)<br/>transformer.transform() → WORKING COPY (VAD/time-stretch)<br/>transcriber.transcribe() → Groq Whisper<br/>mapWorkingCopyMsToOriginalMs(words)<br/>updateDerivedFields(transcript, wordTimings)"]
            R["2B runRenderStoryStage [gate: re-enqueue transcribe if empty]<br/>renderStoryFromTranscript() → Claude<br/>(clean false starts, preserve idiom, NEVER add facts)<br/>parse → prose/title/summary/tags<br/>updateDerivedFields(...)<br/>transitionStoryState(DRAFT → PENDING_APPROVAL)"]
            T -- "enqueue render_story" --> R
        end

        subgraph S3["STAGE 3 · APPROVE & SHARE (consent gate — only path to shared)"]
            direction TB
            APPCHK["getStoryForViewer() — owner + state==pending_approval<br/>(single front door)"]
            BR{"approval type"}
            VOICE["branch A — VOICE (/s/[token])<br/>storage.put('approval-audio')<br/>insert media kind=approval_audio"]
            TAP["branch B — TAP (in-hub, ADR-0004)<br/>approvalAudioMediaId = NULL"]
            WALK["assertStoryTransition:<br/>PENDING_APPROVAL → APPROVED → SHARED<br/>stamp audienceTier + approvedAt"]
            LEDGER[("APPEND consent_records<br/>action=approved_for_sharing<br/>append-only ledger")]
            ASK["if answers an Ask:<br/>asks.status → answered, link storyId"]
            APPCHK --> BR
            BR -- voice --> VOICE --> WALK
            BR -- tap --> TAP --> WALK
            WALK --> LEDGER --> ASK
        end

        S4["STAGE 4 · AUGMENT PROFILE (optional, best-effort, in-hub only)<br/>augmentProfileFromStory() — extract-biography.ts<br/>extractBiographicalProfile(transcript, LLM)<br/>write ONLY to null anchor fields (intake answers always win)"]

        S0 --> S1 --> S2 --> S3 --> S4
    end

    S3 -.->|"enriches anchors used by"| SNAP

    OUT(["SHARED Story { prose, title, summary, tags }<br/>+ transcript + word timings<br/>+ immutable consent record<br/>+ canonical audio (never mutated if consented)"])
    S4 --> OUT

    classDef gate fill:#fde2e2,stroke:#c0392b,color:#000;
    classDef store fill:#e8f0fe,stroke:#1a73e8,color:#000;
    classDef llm fill:#fff3cd,stroke:#b8860b,color:#000;
    class P0,WIND,BR,WALK gate;
    class PUT,DRAFT,LEDGER store;
    class PHRASE,SPEAK,T,R,S4 llm;
```

### Reading the detailed diagram

- **Dashed P0–P6 edges** are the priority ladder inside `pickNextIntent` — exactly one intent is chosen per turn, not a sequence of steps.
- The **`S3 -.-> SNAP` dashed edge** is the feedback coupling: a shared story (and any augmented anchors) becomes the warm-callback / de-dup material the *next* interview session loads at snapshot time.
- Color legend: 🔴 red = gates / branch points, 🔵 blue = storage & ledger writes, 🟡 yellow = LLM / vendor-seam calls.

### Invariants worth remembering

- **The two loops are decoupled.** The interviewer produces questions and steers on distress/off-ramp; it never sets Story state. The spoken answer is what enters the capture pipeline.
- **Storage-first is the durability barrier.** Audio hits the overwrite-rejecting object store *before* any DB row. Canonical bytes are never aliased forward — transcription always operates on a fresh working copy.
- **Consent is one path, recorded once.** `pending_approval → approved → shared` routed through `assertStoryTransition`; one `approved_for_sharing` row in the append-only ledger. Voice vs. tap approval differ only in whether `approvalAudioMediaId` is set.
- **Both async stages are idempotent and self-healing.** Transcribe skips if a transcript already exists; render re-enqueues transcribe if it finds none.
- **Direct intake answers win.** Post-approval biographical augmentation only writes to currently-null anchor fields.
