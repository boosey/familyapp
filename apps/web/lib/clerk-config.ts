/**
 * Single source of truth: is Clerk actually wired up for this process?
 *
 * Lives in its own tiny module (no `server-only`, no DB/fs imports) so it can be imported from:
 *   - middleware.ts (Edge runtime — no Node APIs allowed)
 *   - lib/runtime.ts (Node runtime — picks the auth adapter)
 *   - app/layout.tsx (Server Component — decides whether to mount ClerkProvider)
 *
 * Tight prefix check: a placeholder like `CLERK_SECRET_KEY=test` must NOT activate Clerk —
 * that would silently flip auth into a broken state. Both keys must carry Clerk's standard
 * `sk_live_` / `sk_test_` / `pk_live_` / `pk_test_` prefixes.
 */
export function isClerkConfigured(): boolean {
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  const pub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  return (
    (secret.startsWith("sk_live_") || secret.startsWith("sk_test_")) &&
    (pub.startsWith("pk_live_") || pub.startsWith("pk_test_"))
  );
}
