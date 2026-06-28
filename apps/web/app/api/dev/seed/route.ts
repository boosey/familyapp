/**
 * DEV-ONLY curl-friendly mirror of the /dev/seed server action. POST runs the reseed.
 *
 * Why a separate endpoint: the /dev/seed page uses a Next.js server action, which is hard to
 * trigger from curl/scripts (it requires the Next-Action header + encrypted action id). This
 * route gives the developer a plain HTTP entry to the same logic. NODE_ENV guards it.
 *
 * The JSON response includes tokens/IDs for power users / scripted flows. The /dev/seed PAGE
 * intentionally does not surface these — sign-in is the headline entry point.
 */
import { NextResponse } from "next/server";
import { runSeed } from "@/lib/dev-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { narratorToken, narratorPersonId, draftStoryId } = await runSeed();
  return NextResponse.json({
    ok: true,
    narratorPersonId,
    draftStoryId,
    narratorLink: `/s/${narratorToken}`,
  });
}
