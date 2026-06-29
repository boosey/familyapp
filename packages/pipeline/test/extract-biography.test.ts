import type { BiographicalProfile } from "@chronicle/db";
import { describe, expect, it } from "vitest";
import {
  augmentProfileFromStory,
  extractBiographicalProfile,
  type BiographicalProfileStore,
} from "../src/extract-biography";
import { ScriptedLanguageModel } from "../src/mocks";

function fullProfile(overrides: Partial<BiographicalProfile> = {}): BiographicalProfile {
  return {
    hometown: null,
    siblingContext: null,
    currentLocation: null,
    occupationSummary: null,
    hasChildren: null,
    hasGrandchildren: null,
    ...overrides,
  };
}

/** Tiny in-memory store: records writes and serves a fixed existing profile. */
class FakeStore implements BiographicalProfileStore {
  readonly writes: Array<{ key: keyof BiographicalProfile; value: unknown }> = [];
  constructor(private existing: BiographicalProfile | null) {}

  async loadForNarrator(_personId: string): Promise<{ profile: BiographicalProfile } | null> {
    return this.existing ? { profile: this.existing } : null;
  }

  async writeProfileField<K extends keyof BiographicalProfile>(
    _personId: string,
    key: K,
    value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void> {
    this.writes.push({ key, value });
  }
}

describe("extractBiographicalProfile", () => {
  it("extracts mentioned fields, null for the rest", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({
        hometown: "New Orleans",
        siblingContext: null,
        currentLocation: null,
        occupationSummary: null,
        hasChildren: null,
        hasGrandchildren: null,
      }),
    });
    const r = await extractBiographicalProfile("I grew up in New Orleans.", llm);
    expect(r.hometown).toBe("New Orleans");
    expect(r.siblingContext).toBeNull();
  });

  it("returns {} on unparseable output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "oops" });
    expect(await extractBiographicalProfile("...", llm)).toEqual({});
  });

  it("only keeps the known keys (ignores extra keys the model invents)", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ hometown: "Reno", favoriteColor: "blue" }),
    });
    const r = await extractBiographicalProfile("...", llm);
    expect(r).toEqual({ hometown: "Reno" });
    expect("favoriteColor" in r).toBe(false);
  });
});

describe("augmentProfileFromStory", () => {
  it("writes extracted non-null fields when the existing field is null", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify(
        fullProfile({ hometown: "New Orleans", hasChildren: true }),
      ),
    });
    const store = new FakeStore(fullProfile());
    await augmentProfileFromStory("I grew up in New Orleans.", "person-1", llm, store);
    expect(store.writes).toContainEqual({ key: "hometown", value: "New Orleans" });
    expect(store.writes).toContainEqual({ key: "hasChildren", value: true });
    // Null fields are never written.
    expect(store.writes.some((w) => w.key === "siblingContext")).toBe(false);
  });

  it("does NOT overwrite a field whose existing value is already non-null", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify(fullProfile({ hometown: "Reno", currentLocation: "Austin" })),
    });
    const store = new FakeStore(fullProfile({ hometown: "New Orleans" }));
    await augmentProfileFromStory("...", "person-1", llm, store);
    // hometown already known — left untouched; currentLocation was null — filled.
    expect(store.writes.some((w) => w.key === "hometown")).toBe(false);
    expect(store.writes).toContainEqual({ key: "currentLocation", value: "Austin" });
  });

  it("writes all extracted fields when no profile exists yet", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify(fullProfile({ hometown: "Reno" })),
    });
    const store = new FakeStore(null);
    await augmentProfileFromStory("...", "person-1", llm, store);
    expect(store.writes).toContainEqual({ key: "hometown", value: "Reno" });
  });

  it("does nothing on an empty transcript (no vendor call, no writes)", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify(fullProfile()) });
    const store = new FakeStore(fullProfile());
    await augmentProfileFromStory("", "person-1", llm, store);
    expect(llm.calls.length).toBe(0);
    expect(store.writes.length).toBe(0);
  });
});
