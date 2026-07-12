"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import {
  eraseStory,
  editStoryDetails,
  retargetStoryFamilies,
  editStoryProse,
  setStoryFavorite,
  setStoryLike,
  tagStorySubject,
  untagStorySubject,
  viewerPersonId,
  type FavoriteState,
  type LikeState,
} from "@chronicle/core";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { hub } from "@/app/_copy";

export type ActionResult = { error: string } | undefined;

export async function deleteStoryAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  
  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) {
    return { error: hub.actions.invalidInput };
  }

  plog("story", "deleteStory: received", { person: ctx.personId, story: storyId });

  try {
    const result = await eraseStory(db, ctx, { storyId });
    if (!result.allowed) {
      plogError("story", "deleteStory: not allowed", { story: storyId, reason: result.reason });
      return { error: result.reason };
    }

    // Best-effort storage blob deletion (non-blocking)
    for (const key of result.storageKeys) {
      storage.delete(key).catch((err) => {
        plogError("story", "deleteStory: failed to delete blob key", { key, error: String(err) });
      });
    }

    plog("story", "deleteStory: success", { story: storyId });
  } catch (err) {
    plogError("story", "deleteStory: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.removeFailed };
  }

  revalidatePath("/hub");
  redirect("/hub");
}

export async function editStoryDetailsAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  
  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  const title = formData.get("title");
  const tagsCsv = formData.get("tags");
  
  if (typeof storyId !== "string" || !storyId || typeof title !== "string") {
    return { error: hub.actions.invalidInput };
  }

  const tags = typeof tagsCsv === "string" ? tagsCsv.split(",").map(t => t.trim()).filter(Boolean) : [];

  plog("story", "editStoryDetails: received", { person: ctx.personId, story: storyId, title, tags: tags.join(",") });

  try {
    await editStoryDetails(db, {
      storyId,
      actorPersonId: ctx.personId,
      title,
      tags,
    });
    plog("story", "editStoryDetails: success", { story: storyId });
  } catch (err) {
    plogError("story", "editStoryDetails: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: err instanceof Error ? err.message : hub.actions.saveFailed };
  }

  revalidatePath(`/hub/stories/${storyId}`);
}

export async function retargetStoryFamiliesAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  
  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  const familyIds = formData.getAll("familyIds").map((id) => String(id));
  
  if (typeof storyId !== "string" || !storyId) {
    return { error: hub.actions.invalidInput };
  }

  plog("story", "retargetStoryFamilies: received", { person: ctx.personId, story: storyId, familyIds: familyIds.join(",") });

  try {
    await retargetStoryFamilies(db, ctx, {
      storyId,
      familyIds,
    });
    plog("story", "retargetStoryFamilies: success", { story: storyId });
  } catch (err) {
    plogError("story", "retargetStoryFamilies: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: err instanceof Error ? err.message : hub.actions.saveFailed };
  }

  revalidatePath(`/hub/stories/${storyId}`);
}

export async function editStoryProseAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  
  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  const prose = formData.get("prose");
  const expectedUpdatedAt = formData.get("expectedUpdatedAt");
  
  if (typeof storyId !== "string" || !storyId || typeof prose !== "string") {
    return { error: hub.actions.invalidInput };
  }

  plog("story", "editStoryProse: received", { person: ctx.personId, story: storyId });

  try {
    await editStoryProse(db, {
      storyId,
      prose,
      actorPersonId: ctx.personId,
      expectedUpdatedAt: typeof expectedUpdatedAt === "string" && expectedUpdatedAt ? expectedUpdatedAt : undefined,
    });
    plog("story", "editStoryProse: success", { story: storyId });
  } catch (err) {
    plogError("story", "editStoryProse: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: err instanceof Error ? err.message : hub.actions.saveFailed };
  }

  revalidatePath(`/hub/stories/${storyId}`);
}

export async function setStoryFavoriteAction(
  storyId: string,
  favorited: boolean,
): Promise<{ error?: string; state?: FavoriteState }> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  try {
    const state = await setStoryFavorite(db, ctx, { storyId, favorited });
    revalidatePath(`/hub/stories/${storyId}`);
    return { state };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to favorite" };
  }
}

/**
 * Tag a Person as a subject of a story (issue #35). Accepts EITHER an existing `personId` OR a
 * `newPersonDisplayName` to create an identified `mention` inline. The core call re-resolves the
 * SEE gate (a viewer who can't see the story can't tag on it) — the action does not re-implement
 * authorization; it only re-resolves the auth context and delegates.
 */
export async function tagStorySubjectAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (viewerPersonId(ctx) === null) {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  const personId = formData.get("personId");
  const newPersonDisplayName = formData.get("newPersonDisplayName");
  if (typeof storyId !== "string" || !storyId) {
    return { error: hub.actions.invalidInput };
  }

  const hasExisting = typeof personId === "string" && personId.length > 0;
  const hasNew =
    typeof newPersonDisplayName === "string" && newPersonDisplayName.trim().length > 0;
  if (hasExisting === hasNew) {
    return { error: hub.actions.invalidInput };
  }

  plog("story", "tagStorySubject: received", { person: viewerPersonId(ctx), story: storyId });

  try {
    await tagStorySubject(db, ctx, {
      storyId,
      ...(hasExisting ? { personId: personId as string } : {}),
      ...(hasNew ? { newPersonDisplayName: (newPersonDisplayName as string).trim() } : {}),
    });
    plog("story", "tagStorySubject: success", { story: storyId });
  } catch (err) {
    plogError("story", "tagStorySubject: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: err instanceof Error ? err.message : hub.actions.saveFailed };
  }

  revalidatePath(`/hub/stories/${storyId}`);
}

/** Untag a Person from a story (issue #35). SEE-gated in core. */
export async function untagStorySubjectAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (viewerPersonId(ctx) === null) {
    return { error: hub.actions.notSignedIn };
  }

  const storyId = formData.get("storyId");
  const personId = formData.get("personId");
  if (typeof storyId !== "string" || !storyId || typeof personId !== "string" || !personId) {
    return { error: hub.actions.invalidInput };
  }

  plog("story", "untagStorySubject: received", { person: viewerPersonId(ctx), story: storyId });

  try {
    await untagStorySubject(db, ctx, { storyId, personId });
    plog("story", "untagStorySubject: success", { story: storyId });
  } catch (err) {
    plogError("story", "untagStorySubject: error", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: err instanceof Error ? err.message : hub.actions.saveFailed };
  }

  revalidatePath(`/hub/stories/${storyId}`);
}

export async function setStoryLikeAction(
  storyId: string,
  liked: boolean,
): Promise<{ error?: string; state?: LikeState }> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (viewerPersonId(ctx) === null) {
    return { error: hub.actions.notSignedIn };
  }

  try {
    const state = await setStoryLike(db, ctx, { storyId, liked });
    revalidatePath(`/hub/stories/${storyId}`);
    return { state };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to like" };
  }
}
