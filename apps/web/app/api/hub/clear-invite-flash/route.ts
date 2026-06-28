/**
 * Clears the one-time invite-link flash cookie. The InviteTab renders the link (reading the
 * cookie), then a client effect POSTs here so the cookie is deleted in a Route Handler — the only
 * place Next 15 permits cookie mutation — preserving the show-once guarantee without mutating
 * cookies during render.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  INVITE_FLASH_COOKIE,
  INVITE_FLASH_PATH,
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_FLASH_PATH,
} from "@/lib/invite-flash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const jar = await cookies();
  jar.delete({ name: INVITE_FLASH_COOKIE, path: INVITE_FLASH_PATH });
  jar.delete({ name: MEMBER_INVITE_FLASH_COOKIE, path: MEMBER_INVITE_FLASH_PATH });
  return new NextResponse(null, { status: 204 });
}
