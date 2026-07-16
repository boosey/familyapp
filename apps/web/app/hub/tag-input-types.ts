/**
 * Shared contract for the unified tag field (spec 2026-07-13-unified-tags-photos §1).
 * Three token kinds take three DIFFERENT write paths; they are not interchangeable:
 *   - text   → element of story.tags[]         (editStoryDetails)
 *   - person → story_subjects row              (tagStorySubject / untagStorySubject)
 *   - family → target family in consent ledger (retargetStoryFamilies) — SHARES the story
 * Plain module (no "use client") so server actions, the client component, and tests all import it.
 */
export type TagToken =
  | { kind: "text"; value: string }
  | { kind: "person"; personId: string | null; displayName: string } // null id ⇒ mint on submit
  // `shortName` (steward-set brief label, ADR-0021) is the chip's DISPLAY label when set; `name`
  // (the formal family name) is retained as the fallback. Neither is persisted — the write path uses
  // `familyId` — so they carry display text only.
  | { kind: "family"; familyId: string; name: string; shortName?: string | null };

export interface TagSuggestions {
  people: { personId: string; displayName: string }[];
  /** `shortName` (ADR-0021) is shown in the typeahead/chip in place of `name` when set. */
  families: { id: string; name: string; shortName?: string | null }[];
  tags: string[];
}

/** The label a family tag shows: the steward-set short name when present, else the formal name. */
export function familyTokenLabel(t: {
  name: string;
  shortName?: string | null;
}): string {
  return t.shortName || t.name;
}

export interface TagInputProps {
  tokens: TagToken[];
  suggestions: TagSuggestions;
  /** Called when the user adds a token. */
  onAdd: (token: TagToken) => void;
  /**
   * Called when the user removes a token. The CALLER gates family removal behind a confirm:
   * StoryEditor (story-detail) confirms because removing a family there revokes live sharing;
   * ComposingEditor does NOT confirm because families picked during compose only stage into the
   * finish picker — nothing is shared until Finish. TagInput itself only marks family chips
   * distinct and fires this; it holds no authorization.
   */
  onRemove: (token: TagToken) => void;
  disabled?: boolean;
  /**
   * Token keys (see `tokenKey`) whose chip renders WITHOUT a remove (✕) button — the caller has
   * decided they can't be removed here. StoryEditor uses this to keep the LAST remaining family chip:
   * removing it would silently un-share the story. Absent ⇒ every chip is removable (composer default).
   */
  nonRemovableTokenKeys?: Set<string>;
}

/** Stable identity for a token, used as a React key and for de-dup. */
export function tokenKey(t: TagToken): string {
  if (t.kind === "text") return `text:${t.value}`;
  if (t.kind === "person") return `person:${t.personId ?? `new:${t.displayName}`}`;
  return `family:${t.familyId}`;
}
