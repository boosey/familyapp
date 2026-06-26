/**
 * DEV-ONLY curl-friendly mirror of the /dev/seed server action. POST runs the reseed.
 *
 * Why a separate endpoint: the /dev/seed page uses a Next.js server action, which is hard to
 * trigger from curl/scripts (it requires the Next-Action header + encrypted action id). This
 * route gives the developer a plain HTTP entry to the same logic. NODE_ENV guards it.
 */
import { NextResponse } from "next/server";
import { runSeed } from "@/lib/dev-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { elderToken, elderPersonId, pendingStoryId } = await runSeed();
  return NextResponse.json({
    ok: true,
    elderPersonId,
    pendingStoryId,
    elderLink: `/s/${elderToken}`,
    approvalLink: `/s/${elderToken}/approve/${pendingStoryId}`,
  });
}
