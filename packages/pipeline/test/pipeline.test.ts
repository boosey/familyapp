import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStoryForViewer,
  listProseRevisions,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { sql } from "drizzle-orm";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultWorkingCopyTransformer,
  createPipeline,
  InProcessJobQueue,
  parseRenderResponse,
  ScriptedLanguageModel,
  ScriptedTranscriber,
  type WordTiming,
} from "../src/index";

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function makeNarrator(): Promise<string> {
  const [narrator] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
    .returning();
  return narrator!.id;
}

async function seedDraftStory(
  narratorId: string,
  bytes: Uint8Array,
  promptQuestion?: string,
): Promise<{ storyId: string; storageKey: string; checksum: string }> {
  const storageKey = `story-audio/${narratorId}/test.webm`;
  await storage.put({ key: storageKey, bytes, contentType: "audio/webm" });
  const checksum = sha(bytes);
  const persisted = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: narratorId,
      storageKey,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum,
    },
    promptQuestion ? { promptQuestion } : {},
  );
  return { storyId: persisted.story.id, storageKey, checksum };
}

describe("pipeline — canonical audio invariant (LOCKED)", () => {
  it("after a full pipeline run, the canonical bytes in storage are byte-identical", async () => {
    const narratorId = await makeNarrator();
    const canonical = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { storyId, storageKey, checksum } = await seedDraftStory(narratorId, canonical);

    const transcriber = new ScriptedTranscriber({ text: "I was born on a farm." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const after = await storage.getBytes(storageKey);
    expect(after).not.toBeNull();
    expect(sha(after!)).toBe(checksum);
    expect(Array.from(after!)).toEqual(Array.from(canonical));
  });

  it("the canonical bytes are NEVER handed to the transcriber (working copy is a separate Uint8Array)", async () => {
    const narratorId = await makeNarrator();
    const canonical = new Uint8Array([99, 98, 97]);
    const canonicalChecksum = sha(canonical);
    const { storyId, storageKey } = await seedDraftStory(narratorId, canonical);

    let capturedWorkingCopy: Uint8Array | null = null;
    const transcriber = new ScriptedTranscriber({ text: "x" });
    // Wrap the transcriber to mutate the bytes IT received after the call — this proves the
    // canonical bytes in storage are immune to downstream-buffer mutation, which they would
    // not be if any layer aliased them forward. (Reference inequality alone is too weak a
    // claim because both `storage.getBytes` and the stub transformer already `.slice()`; a
    // future contributor who removes a `.slice()` would still pass a reference-inequality
    // assertion as long as the OTHER `.slice()` remained.)
    const mutatingTranscriber = {
      calls: transcriber.calls,
      async transcribe(input: { bytes: Uint8Array; contentType: string }) {
        const res = await transcriber.transcribe(input);
        capturedWorkingCopy = input.bytes;
        // Scribble all over the buffer the transcriber received.
        for (let i = 0; i < input.bytes.length; i++) input.bytes[i] = 0;
        return res;
      },
    };
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({
      db,
      storage,
      transcriber: mutatingTranscriber,
      languageModel,
    });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    expect(transcriber.calls.length).toBe(1);
    expect(capturedWorkingCopy).not.toBeNull();
    // Storage bytes survived the downstream mutation: checksum unchanged, value unchanged.
    const after = (await storage.getBytes(storageKey))!;
    expect(sha(after)).toBe(canonicalChecksum);
    expect(Array.from(after)).toEqual([99, 98, 97]);
  });

  it("storage holds exactly ONE object after the pipeline runs (no working-copy Media row or blob)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([5, 5, 5]));
    const transcriber = new ScriptedTranscriber({ text: "hello" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    // Exactly one storage object (the canonical recording — working copy is transient and
    // never persisted as a Media row or storage blob).
    expect(storage.size).toBe(1);
    // And exactly one media row in the DB (the canonical). Working-copy bytes are NOT a
    // persisted artifact, so a future bug that wrote a Media row for the working copy would
    // be caught here — even though the pipeline package structurally cannot import the table.
    const r = (await db.execute(
      sql.raw(`select count(*)::int as n from media`),
    )) as unknown as { rows: Array<{ n: number }> };
    expect(r.rows[0]!.n).toBe(1);
  });
});

describe("pipeline — end-to-end stages produce a pending_approval story (still private)", () => {
  it("populates transcript + prose, moves draft -> pending_approval, audienceTier stays private", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(
      narratorId,
      new Uint8Array([1]),
      "Tell me about your childhood",
    );

    const transcriber = new ScriptedTranscriber({ text: "I grew up on a farm in Iowa." });
    const languageModel = new ScriptedLanguageModel({
      respond: () =>
        JSON.stringify({
          prose: "I grew up on a farm in Iowa.",
          title: "Growing up on the farm",
          summary: "A childhood on an Iowa farm.",
          tags: ["childhood", "farm", "iowa"],
        }),
    });

    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story).not.toBeNull();
    expect(story!.transcript).toBe("I grew up on a farm in Iowa.");
    expect(story!.prose).toBe("I grew up on a farm in Iowa.");
    expect(story!.title).toBe("Growing up on the farm");
    expect(story!.tags).toEqual(["childhood", "farm", "iowa"]);
    expect(story!.state).toBe("pending_approval");
    // STILL PRIVATE — no consent yet (Increment 5 introduces the approval gate).
    expect(story!.audienceTier).toBe("private");
  });

  it("the LLM receives narrator context (spoken name + birth year) so the renderer can set tone", async () => {
    const [narrator] = await db
      .insert(persons)
      .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
      .returning();
    const { storyId } = await seedDraftStory(
      narrator!.id,
      new Uint8Array([1]),
      "Tell me about your wedding",
    );
    const transcriber = new ScriptedTranscriber({ text: "It was a sunny day." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    const userContent = languageModel.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userContent).toContain("Eleanor");
    expect(userContent).toContain("1942");
  });

  it("the LLM is given the prompt question so the model can match the framing the narrator heard", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(
      narratorId,
      new Uint8Array([1]),
      "What was your wedding day like?",
    );
    const transcriber = new ScriptedTranscriber({ text: "It was raining." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const userContent = languageModel.calls[0]!.messages.find((m) => m.role === "user")!.content;
    expect(userContent).toContain("What was your wedding day like?");
    expect(userContent).toContain("It was raining.");
  });
});

describe("pipeline — word timings are mapped back to 1x time before persisting", () => {
  it("scales sped-up timings by speedFactor against the segment table", async () => {
    const narratorId = await makeNarrator();
    // 10s of canonical audio; default transformer reports speedFactor=1.6, so a working-copy
    // segment runs 0..(10000/1.6) = 0..6250ms. A word at workingCopyMs=3125 (the midpoint of
    // the working copy) should map back to 5000ms in the original.
    const canonical = new Uint8Array([0]);
    const storageKey = `story-audio/${narratorId}/timing.webm`;
    await storage.put({ key: storageKey, bytes: canonical, contentType: "audio/webm" });
    const persisted = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narratorId,
      storageKey,
      contentType: "audio/webm",
      durationSeconds: 10,
      checksum: sha(canonical),
    });

    const words: WordTiming[] = [
      { word: "first", startMs: 0, endMs: 500 },
      { word: "middle", startMs: 3125, endMs: 3500 },
    ];
    const transcriber = new ScriptedTranscriber({ text: "first middle", words });
    const languageModel = new ScriptedLanguageModel();
    // Use an HONEST 1.6x transformer (simulates a real DSP adapter that actually time-stretches).
    // The stub default reports speedFactor=1.0 because it does not transform; using 1.6 here
    // exercises the mapping math that production will run.
    const pipeline = createPipeline({
      db,
      storage,
      transcriber,
      languageModel,
      workingCopyTransformer: createDefaultWorkingCopyTransformer({ speedFactor: 1.6 }),
    });

    await pipeline.runTranscribeStage({ storyId: persisted.story.id });

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      persisted.story.id,
    );
    const persistedTimings = story!.transcriptWordTimings!;
    expect(persistedTimings[0]).toEqual({ word: "first", startMs: 0, endMs: 800 });
    // 3125 * 1.6 = 5000ms (1x original time). 3500 * 1.6 = 5600ms.
    expect(persistedTimings[1]).toEqual({ word: "middle", startMs: 5000, endMs: 5600 });
  });
});

describe("pipeline — idempotency (durable retry safety)", () => {
  it("re-running the pipeline does not re-call vendors and does not re-transition state", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1, 2, 3]));
    const transcriber = new ScriptedTranscriber({ text: "the transcript" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    expect(transcriber.calls.length).toBe(1);
    expect(languageModel.calls.length).toBe(1);

    // Re-run the entire pipeline — every stage is idempotent.
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    expect(transcriber.calls.length).toBe(1);
    expect(languageModel.calls.length).toBe(1);

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story!.state).toBe("pending_approval");
  });

  it("enqueueing the same job twice while pending dedupes (durable-queue style)", async () => {
    const queue = new InProcessJobQueue();
    const id1 = await queue.enqueue("transcribe", { storyId: "abc" });
    const id2 = await queue.enqueue("transcribe", { storyId: "abc" });
    expect(id1).toBe(id2);
    expect(queue.pending().length).toBe(1);
  });

  it("empty vendor transcript surfaces as an error (no ping-pong, no wasted paid retries)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1, 1, 1]));
    const transcriber = new ScriptedTranscriber({ text: "" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await expect(pipeline.runToCompletion()).rejects.toThrow(
      /transcriber returned empty text/,
    );
    // Vendor called exactly ONCE — no ping-pong burning 8 calls.
    expect(transcriber.calls.length).toBe(1);
    expect(languageModel.calls.length).toBe(0);
    // Story is untouched (transcript still null) so a deliberate retry by a human is possible.
    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story!.transcript).toBeNull();
    expect(story!.state).toBe("draft");
  });

  it("the queue caps attempts per (name, storyId) per drain — a self-requeue loop terminates", async () => {
    const queue = new InProcessJobQueue();
    let calls = 0;
    queue.register("transcribe", async (p) => {
      calls += 1;
      // Pathological handler: always re-enqueues itself. Without the cap, drain would spin.
      await queue.enqueue("transcribe", p);
    });
    await queue.enqueue("transcribe", { storyId: "loopy" });
    await expect(queue.drain()).rejects.toThrow(/exceeded .* attempts/);
    // Cap is 8; we expect close to that many calls, not infinite.
    expect(calls).toBeLessThanOrEqual(8);
    expect(calls).toBeGreaterThan(1);
  });
});

describe("pipeline — derived fields are regenerable", () => {
  it("clearing the transcript and re-running produces a fresh transcript + prose", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([7, 7]));
    const transcriber = new ScriptedTranscriber({ text: "first transcript" });
    const languageModel = new ScriptedLanguageModel({
      respond: () =>
        JSON.stringify({ prose: "first prose", title: "t1", summary: "s1", tags: [] }),
    });
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    // Simulate a model upgrade: clear the derived fields and re-run.
    await updateDerivedFields(db, storyId, { transcript: "", prose: "" });
    transcriber.setScript({ text: "second transcript (better model)" });
    languageModel.setScript({
      respond: () =>
        JSON.stringify({ prose: "second prose", title: "t2", summary: "s2", tags: ["new"] }),
    });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story!.transcript).toBe("second transcript (better model)");
    expect(story!.prose).toBe("second prose");
    expect(story!.tags).toEqual(["new"]);
    // State stays at pending_approval (the no-op transition is fine).
    expect(story!.state).toBe("pending_approval");
  });
});

describe("pipeline — defends spec hard cap on speedFactor (defense in depth)", () => {
  it("refuses a transformer that reports speedFactor > 2.0 (spec hard cap)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1]));
    const transcriber = new ScriptedTranscriber({ text: "x" });
    const languageModel = new ScriptedLanguageModel();
    const evilTransformer = {
      async transform(input: { bytes: Uint8Array; contentType: string }) {
        return {
          bytes: input.bytes.slice(),
          contentType: input.contentType,
          speedFactor: 4.0, // OUT OF SPEC — orchestrator must refuse
          segments: [
            { originalStartMs: 0, originalEndMs: 0, workingCopyStartMs: 0, workingCopyEndMs: 0 },
          ],
        };
      },
    };
    const pipeline = createPipeline({
      db,
      storage,
      transcriber,
      languageModel,
      workingCopyTransformer: evilTransformer,
    });
    await expect(pipeline.runTranscribeStage({ storyId })).rejects.toThrow(
      /out-of-spec speedFactor/,
    );
  });
});

describe("pipeline — state machine guard", () => {
  it("transitionStoryState rejects illegal jumps (draft -> shared) — gate is wired", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1]));
    await expect(transitionStoryState(db, storyId, "shared")).rejects.toThrow(
      /illegal story state transition/,
    );
  });

  it("audienceTier is never changed by the pipeline (stays `private` through pending_approval)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1]));
    const transcriber = new ScriptedTranscriber({ text: "x" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story!.audienceTier).toBe("private");
    // The narrow updateDerivedFields surface deliberately rejects audienceTier writes — if a
    // future contributor adds the field, this assertion (cast to bypass the type) and the
    // resulting audienceTier remaining `private` pins the invariant.
    await updateDerivedFields(db, storyId, {
      transcript: "x",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audienceTier: "family",
    } as unknown as Parameters<typeof updateDerivedFields>[2]);
    const after = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(after!.audienceTier).toBe("private");
  });

  it("the render stage moves draft -> pending_approval ONLY via assertStoryTransition", async () => {
    // Wedge: pre-set the story to `archived` (legal from draft). The render stage must NOT be
    // able to force it into pending_approval — assertStoryTransition forbids that jump.
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([1]));
    await transitionStoryState(db, storyId, "archived");
    // Manually populate a transcript so the render stage proceeds past its precondition.
    await updateDerivedFields(db, storyId, { transcript: "anything" });

    const transcriber = new ScriptedTranscriber({ text: "x" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await expect(
      pipeline.runRenderStoryStage({ storyId }),
    ).rejects.toThrow(/illegal story state transition: archived -> pending_approval/);
  });
});

describe("parseRenderResponse — defensive parsing", () => {
  it("treats an array as non-record JSON and falls back to plain-text handling", () => {
    const out = parseRenderResponse("[1, 2, 3]", "the original transcript");
    // Array is rejected as not record-shaped; the text-fallback branch runs (prose = trimmed text)
    expect(out.prose).toBe("[1, 2, 3]");
  });

  it("treats `null` as non-record JSON (typeof null === 'object' is the JS footgun)", () => {
    const out = parseRenderResponse("null", "fallback prose");
    expect(out.prose).toBe("null"); // text-fallback prose is the trimmed input
  });

  it("strips ```json fences before parsing", () => {
    const out = parseRenderResponse(
      "```json\n{\"prose\":\"clean\",\"title\":\"t\",\"summary\":\"s\",\"tags\":[]}\n```",
      "fallback",
    );
    expect(out.prose).toBe("clean");
    expect(out.title).toBe("t");
  });
});

describe("pipeline — prose provenance", () => {
  it("appends ai_transcribed (L1) and ai_polished (L2) with model ids + render prompt", async () => {
    const narratorId = await makeNarrator();
    const canonical = new Uint8Array([1, 2, 3]);
    const { storyId } = await seedDraftStory(narratorId, canonical);

    const transcriber = new ScriptedTranscriber({
      text: "I was born on a farm.",
      modelId: "whisper-test",
    });
    const languageModel = new ScriptedLanguageModel({ modelId: "claude-test" });
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const rows = await listProseRevisions(db, storyId);
    expect(rows.map((r) => r.level)).toEqual(["ai_transcribed", "ai_polished"]);
    const [l1, l2] = rows;
    expect(l1!.modelId).toBe("whisper-test");
    expect(l1!.promptText).toBeNull();
    expect(l2!.modelId).toBe("claude-test");
    expect(typeof l2!.promptText).toBe("string");
    expect(l2!.promptText!.length).toBeGreaterThan(0);
  });

  it("does not append duplicate revisions when the pipeline is re-run (idempotent)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([9, 9]));
    const transcriber = new ScriptedTranscriber({ text: "A short memory." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    // Re-run: both stages hit their idempotency early-returns, so no new rows.
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const rows = await listProseRevisions(db, storyId);
    expect(rows).toHaveLength(2);
  });

  it("completes a partially-rendered story on resume without duplicating L2", async () => {
    // Guards "resume-after-partial-render completes with exactly one L2, no duplicate."
    // Under the corrected ordering (update prose -> transition state -> append L2), a crash
    // can leave the story with prose set but state still `draft` and NO ai_polished row yet.
    // We reconstruct exactly that realistic post-partial-failure state, then re-run the full
    // pipeline. Transcribe skips (transcript is set); render re-enters (state is still draft)
    // and must finish with EXACTLY ONE L2 row — never two.
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([4, 2]));
    // Set transcript + prose but leave state `draft` and append NO revisions — the precise
    // state a crash between transition and the L2 append (or before either) would leave behind.
    await updateDerivedFields(db, storyId, {
      transcript: "A half-finished memory.",
      prose: "A half-finished memory, polished.",
    });
    expect(await listProseRevisions(db, storyId)).toHaveLength(0);

    const transcriber = new ScriptedTranscriber({ text: "A half-finished memory." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const rows = await listProseRevisions(db, storyId);
    expect(rows.filter((r) => r.level === "ai_polished")).toHaveLength(1);
    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story!.state).toBe("pending_approval");
  });
});

describe("pipeline — no vendor SDK imports leak into IP code", () => {
  it("none of @chronicle/{core,db,storage,capture,pipeline,interviewer} src files import a vendor SDK", () => {
    // Tight allowlist: only these strings are permitted inside pipeline IP code. Any vendor
    // SDK import (e.g. "groq-sdk", "@anthropic-ai/sdk", "openai", "elevenlabs", "inngest",
    // "@aws-sdk/...") is a violation — vendors live exclusively in adapter files that nothing
    // in @chronicle/{core,db,storage,capture,pipeline} currently has.
    const forbidden = [
      "groq-sdk",
      "@anthropic-ai/sdk",
      "openai",
      "elevenlabs",
      "inngest",
      "@aws-sdk",
      "@google/genai",
      "@google/generative-ai",
      "@google-cloud/speech",
      "@deepgram/sdk",
      "assemblyai",
      "cohere-ai",
      "twilio",
      "telnyx",
      "@vonage/server-sdk",
      "trigger.dev",
      "@trigger.dev/sdk",
    ];
    // Scope-prefix bans: any import under one of these npm scopes is forbidden, regardless of the
    // concrete package (e.g. "@sentry/nextjs", "@sentry/node", "@sentry/core"). Sentry lives only
    // in apps/web — it must never leak into the IP packages. Matched on the quoted import prefix so
    // a future `import ... from "@sentry/anything"` fails CI.
    const forbiddenPrefixes = ["@sentry/"];
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const roots = ["packages/core/src", "packages/db/src", "packages/storage/src", "packages/capture/src", "packages/pipeline/src", "packages/interviewer/src"];
    // Documented exception: `packages/storage/src/r2.ts` is the production R2 adapter and is the
    // single place in storage/src permitted to import `@aws-sdk/*` (R2 speaks S3). It sits behind
    // the `MediaStorage` interface, so no vendor types leak into the IP packages downstream.
    // Any new entry here requires a DECISIONS.md entry explaining why the adapter cannot live in a separate service.
    const ADAPTER_EXCEPTIONS = new Set<string>(["packages/storage/src/r2.ts"]);
    const offenders: string[] = [];
    for (const root of roots) {
      walk(join(repoRoot, root), (full) => {
        const relPath = full.slice(repoRoot.length).split(sep).join("/");
        if (ADAPTER_EXCEPTIONS.has(relPath)) return;
        const contents = readFileSync(full, "utf8");
        for (const f of forbidden) {
          if (contents.includes(`"${f}"`) || contents.includes(`'${f}'`)) {
            offenders.push(`${full} imports ${f}`);
          }
        }
        for (const p of forbiddenPrefixes) {
          if (contents.includes(`"${p}`) || contents.includes(`'${p}`)) {
            offenders.push(`${full} imports ${p}*`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);

    function walk(dir: string, visit: (p: string) => void): void {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, visit);
        else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) visit(full);
      }
    }
  });
});
