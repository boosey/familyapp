"use server";
/**
 * Typeahead data for the unified tag field: the author's active families, the people they know
 * (union of kin across those families, deduped), and the story's existing freeform tags.
 * Read-only; authorizes via the runtime auth context. Never trusts the storyId to grant anything —
 * story tags are read through the front door (getStoryForViewer).
 */
import {
  listActiveFamiliesForPerson,
  listMyKin,
  getStoryForViewer,
  viewerPersonId,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import type { TagSuggestions } from "./tag-input-types";

export async function loadTagSuggestionsAction(
  storyId: string,
): Promise<TagSuggestions | { error: string }> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  const person = viewerPersonId(ctx);
  if (person === null) return { error: "Not signed in." };

  const families = await listActiveFamiliesForPerson(db, person);

  // People = union of the viewer's kin across every active family, deduped by personId, identified
  // rows only (an unidentified bridge node has displayName === null and is not a taggable subject).
  const kinLists = await Promise.all(
    families.map((fam) => listMyKin(db, ctx, fam.familyId)),
  );
  const peopleById = new Map<string, string>();
  for (const kin of kinLists) {
    for (const k of kin) {
      if (k.identified && k.displayName) peopleById.set(k.personId, k.displayName);
    }
  }

  // Existing tags on THIS story (front-door read; empty if not visible).
  const story = await getStoryForViewer(db, ctx, storyId);
  const tags = story?.tags ?? [];

  return {
    people: [...peopleById].map(([personId, displayName]) => ({ personId, displayName })),
    families: families.map((f) => ({ id: f.familyId, name: f.familyName })),
    tags,
  };
}
