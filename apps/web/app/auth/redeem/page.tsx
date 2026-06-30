/**
 * /auth/redeem — the CLIENT redemption gate for the Clerk magic-link handoff (ADR-0003).
 *
 * The `/a/[token]` route minted a one-time Clerk sign-in token (ticket) and redirected the browser
 * here with `?ticket=..&dest=..&token=..` (see `buildRedeemUrl`). Clerk forbids forging a session
 * server-side from a userId, so the ticket must be redeemed in the BROWSER via `useSignIn`. This
 * server component is only the gate: it sanitizes the destination, bails out warmly when redemption
 * is impossible, and otherwise mounts the client redeemer.
 *
 * This route is ONLY reachable in Clerk mode — the mock/dev adapter returns "established" (a cookie)
 * and never produces a handoff. So when Clerk is not configured, or there is no ticket, we degrade
 * to the warm `/s/[token]` surface (or /hub) rather than render a redeemer that cannot work.
 */
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/clerk-config";
import { safeInternalDest } from "@/lib/magic-link";
import { RedeemClientLoader } from "./RedeemClientLoader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string; dest?: string; token?: string }>;
}) {
  const { ticket, dest, token } = await searchParams;

  // Where to land if redemption can't proceed: the originating link's resting surface, else the hub.
  const fallback = token ? `/s/${encodeURIComponent(token)}` : "/hub";
  // Sanitize the destination server-side (the client redeemer re-sanitizes — defense in depth).
  const safeDest = safeInternalDest(dest, "/hub");

  if (!isClerkConfigured() || !ticket) {
    // No Clerk (mock mode can't have produced this) or no ticket → nothing to redeem; warm-degrade.
    redirect(fallback);
  }

  return (
    <RedeemClientLoader ticket={ticket} dest={safeDest} fallback={fallback} />
  );
}
