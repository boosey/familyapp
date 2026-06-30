"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

/**
 * Dynamic-import boundary for the Clerk redeemer — mirrors KindredAccountMenu → ClerkSignOutItem.
 *
 * `next/dynamic` with `{ ssr: false }` may only be called from a client component, so this thin
 * "use client" wrapper exists solely to host that call: it code-splits @clerk/nextjs (imported by
 * RedeemClient via `useSignIn`) into its own chunk the browser fetches ONLY when this loader
 * renders — i.e. only on the Clerk-mode `/auth/redeem` path. In mock mode the page redirects before
 * this ever mounts, so the Clerk chunk is never requested.
 */
const RedeemClientDynamic = dynamic(
  () => import("./RedeemClient").then((m) => ({ default: m.RedeemClient })),
  { ssr: false, loading: () => <RedeemPlaceholder /> },
);

export interface RedeemClientLoaderProps {
  ticket: string;
  dest: string;
  fallback: string;
}

export function RedeemClientLoader(props: RedeemClientLoaderProps) {
  return <RedeemClientDynamic {...props} />;
}

const placeholderStyle: CSSProperties = {
  minHeight: "60vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-meta)",
};

/** Warm, minimal "Signing you in…" placeholder — shown while the Clerk chunk loads and while the
 *  ticket is being redeemed, so there's no blank flash. No interactive UI. */
export function RedeemPlaceholder() {
  return <div style={placeholderStyle}>Signing you in…</div>;
}
