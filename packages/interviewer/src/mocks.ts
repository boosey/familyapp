/**
 * Deterministic, dependency-free mocks of the interviewer seams. Used by the turn-loop tests and
 * by anyone downstream who wants to exercise the loop without paid vendors.
 */
import type { BiographicalProfile } from "@chronicle/db";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  MemorySource,
  PendingAsk,
  PriorStoryMemory,
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
