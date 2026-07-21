/**
 * Deterministic, dependency-free mocks of the interviewer seams. Used by the turn-loop tests and
 * by anyone downstream who wants to exercise the loop without paid vendors.
 */
import type { BiographicalProfile, FollowUpCandidate } from "@chronicle/db";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  FollowUpEvaluation,
  FollowUpEvaluationInput,
  FollowUpEvaluator,
  LifeEventSink,
  MemorySource,
  PendingAsk,
  PersistResolvedStoryDateInput,
  PriorStoryMemory,
  RecordStatedLifeEventInput,
  StoryDateSink,
  Voice,
  VoiceSpeakInput,
  VoiceSpeakResult,
} from "./contracts";

export class ScriptedVoice implements Voice {
  readonly calls: VoiceSpeakInput[] = [];
  constructor(
    private readonly modelId: string = "mock-elevenlabs",
    /** Override to simulate a vendor failure (returns a fake-but-typed result). */
    private readonly bytesFor: (text: string) => Uint8Array = (t) =>
      new TextEncoder().encode(t),
  ) {}

  async speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult> {
    this.calls.push(input);
    const bytes = this.bytesFor(input.text);
    // ~150 wpm => ~400ms/word; deterministic for tests.
    const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
    return {
      bytes,
      contentType: "audio/mpeg",
      durationMs: wordCount * 400,
      modelId: this.modelId,
    };
  }
}

export class InMemoryAskSource implements AskSource {
  readonly routed: string[] = [];

  constructor(private readonly byNarrator: Map<string, PendingAsk[]> = new Map()) {}

  setAsks(personId: string, asks: PendingAsk[]): void {
    this.byNarrator.set(personId, asks);
  }

  async pendingForNarrator(personId: string): Promise<PendingAsk[]> {
    return this.byNarrator.get(personId)?.slice() ?? [];
  }

  async markRouted(askId: string): Promise<void> {
    this.routed.push(askId);
  }
}

export class InMemoryMemorySource implements MemorySource {
  constructor(private readonly byNarrator: Map<string, PriorStoryMemory[]> = new Map()) {}

  setStories(personId: string, stories: PriorStoryMemory[]): void {
    this.byNarrator.set(personId, stories);
  }

  async recentStoriesForNarrator(personId: string, limit: number): Promise<PriorStoryMemory[]> {
    const all = this.byNarrator.get(personId) ?? [];
    return all.slice(0, limit);
  }
}

export class InMemoryAnchorSource implements AnchorSource {
  constructor(private readonly byNarrator: Map<string, BiographicalAnchors> = new Map()) {}

  set(anchors: BiographicalAnchors): void {
    this.byNarrator.set(anchors.personId, anchors);
  }

  async loadForNarrator(personId: string): Promise<BiographicalAnchors | null> {
    return this.byNarrator.get(personId) ?? null;
  }

  async writeProfileField<K extends keyof BiographicalProfile>(
    personId: string,
    key: K,
    value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void> {
    const existing = this.byNarrator.get(personId);
    if (!existing) return;
    this.byNarrator.set(personId, {
      ...existing,
      profile: { ...existing.profile, [key]: value },
    });
  }
}

/**
 * Deterministic evaluator mock. `script[n]` is the candidate list returned on the n-th `evaluate`
 * call, so a test can drive a multi-turn thread (turn 0 proposes, turn 1 proposes again, …).
 * Missing/exhausted entries return an empty candidate list (→ thread ends).
 */
export class ScriptedFollowUpEvaluator implements FollowUpEvaluator {
  readonly calls: FollowUpEvaluationInput[] = [];

  constructor(
    private readonly script: FollowUpCandidate[][] = [],
    private readonly modelId: string = "mock-follow-up-evaluator",
  ) {}

  async evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation> {
    const idx = this.calls.length;
    this.calls.push(input);
    return { candidates: this.script[idx] ?? [], modelId: this.modelId };
  }
}

/**
 * Records every resolved Story date the loop persists, in order — the assertion point for live
 * date derivation (issue #243): a self-dating telling lands here with its occurrence and
 * provenance note; an unresolvable telling never produces a call.
 */
export class InMemoryStoryDateSink implements StoryDateSink {
  readonly persisted: PersistResolvedStoryDateInput[] = [];

  async persistResolvedStoryDate(input: PersistResolvedStoryDateInput): Promise<void> {
    this.persisted.push(input);
  }
}

/**
 * Records every stated life-event fact the loop captures, in order — the assertion point for
 * life-event capture (issue #245): "we married in '58" lands here as a wedding event on the
 * narrator; an anchor-relative reference ("ten years after we married") never produces a call.
 * Idempotency (person + kind + date) is a property of the prod write side, so this mock stores
 * every call raw — a test asserting dedupe belongs over the real DB (packages/core).
 */
export class InMemoryLifeEventSink implements LifeEventSink {
  readonly recorded: RecordStatedLifeEventInput[] = [];

  async recordStatedLifeEvent(input: RecordStatedLifeEventInput): Promise<void> {
    this.recorded.push(input);
  }
}
