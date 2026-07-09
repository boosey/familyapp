"use server";

import type { BiographicalProfile } from "@chronicle/db";
import {
  updatePersonDisplayName,
  updatePersonSpokenName,
  updatePersonBirthDate,
  updateBiographicalAnchor,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

type SaveResult = { ok: true } | { error: string };

async function requireAccount(): Promise<
  { db: Awaited<ReturnType<typeof getRuntime>>["db"]; personId: string } | { error: string }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "not_signed_in" };
  return { db, personId: ctx.personId };
}

export async function saveDisplayNameAction(displayName: string): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await updatePersonDisplayName(ctx.db, ctx.personId, displayName);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

export async function saveSpokenNameAction(spokenName: string): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await updatePersonSpokenName(ctx.db, ctx.personId, spokenName);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

export async function saveBirthDateAction(input: {
  year: number;
  month: number;
  day: number;
}): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await updatePersonBirthDate(ctx.db, ctx.personId, input);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

export async function saveAnchorAction<K extends keyof BiographicalProfile>(
  key: K,
  value: BiographicalProfile[K],
): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await updateBiographicalAnchor(ctx.db, ctx.personId, key, value);
    if (key === "hasChildren" && value === false) {
      await updateBiographicalAnchor(ctx.db, ctx.personId, "hasGrandchildren", null);
    }
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}
