"use client";

/**
 * RedeemClient — the ONLY place @clerk/nextjs is imported for the magic-link redemption.
 *
 * This file must never be imported with a static `import` statement. It is loaded exclusively via
 * `next/dynamic` in RedeemClientLoader so the @clerk/nextjs chunk is code-split and never fetched in
 * mock/dev mode (where ClerkProvider is absent and useSignIn() would throw). Mirrors ClerkSignOutItem.
 *
 * Redemption (ADR-0003): a Clerk sign-in token is single-use. We redeem it via the `ticket` strategy,
 * activate the resulting session, then HARD-navigate to the destination so the authed hub's server
 * components read the freshly-set Clerk session cookie. Any failure (expired/used/invalid ticket, or
 * an incomplete attempt) warm-degrades to the fallback surface.
 */
import { useSignIn } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { safeInternalDest } from "@/lib/magic-link";

export interface RedeemClientProps {
  ticket: string;
  dest: string;
  fallback: string;
}

const messageStyle: CSSProperties = {
  minHeight: "60vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-meta)",
};

export function RedeemClient({ ticket, dest, fallback }: RedeemClientProps) {
  const { isLoaded, signIn, setActive } = useSignIn();
  // A Clerk sign-in token is SINGLE-USE: React strict-mode's double-invoked effect would burn the
  // ticket on the first run and fail the second. Guard so redemption runs exactly once.
  const ran = useRef(false);

  useEffect(() => {
    if (!isLoaded || !signIn || !setActive || ran.current) return;
    ran.current = true;

    // Re-sanitize on the client (defense in depth — the server already sanitized `dest`).
    const safeDest = safeInternalDest(dest, "/hub");

    void (async () => {
      try {
        const attempt = await signIn.create({ strategy: "ticket", ticket });
        if (attempt.status === "complete" && attempt.createdSessionId) {
          await setActive({ session: attempt.createdSessionId });
          // Hard nav (not router.push): the hub renders on the server and must observe the session
          // cookie Clerk just set; a client-side transition can render before the cookie is visible.
          window.location.replace(safeDest);
        } else {
          // Needs-more-steps / not complete — there's no interactive UI here, so warm-degrade.
          window.location.replace(fallback);
        }
      } catch (err) {
        // Expired, already-used, or otherwise invalid ticket (or any Clerk error) → warm-degrade.
        console.warn("auth/redeem: sign-in token redemption failed → degrading.", err);
        window.location.replace(fallback);
      }
    })();
  }, [isLoaded, signIn, setActive, ticket, dest, fallback]);

  return <div style={messageStyle}>Signing you in…</div>;
}
