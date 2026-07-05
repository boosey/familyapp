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

    // Best-effort storage blob deletion
    for (const key of result.storageKeys) {
      await storage.delete(key).catch((err) => {
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
