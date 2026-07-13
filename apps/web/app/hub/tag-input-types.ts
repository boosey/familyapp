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
  | { kind: "family"; familyId: string; name: string };

export interface TagSuggestions {
  people: { personId: string; displayName: string }[];
  families: { id: string; name: string }[];
  tags: string[];
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
}

/** Stable identity for a token, used as a React key and for de-dup. */
export function tokenKey(t: TagToken): string {
  if (t.kind === "text") return `text:${t.value}`;
  if (t.kind === "person") return `person:${t.personId ?? `new:${t.displayName}`}`;
  return `family:${t.familyId}`;
}
