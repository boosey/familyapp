/**
 * SHARED CONTRACT (ADR-0029) — the props every Account section component receives.
 *
 * The shell (`[section]/page.tsx`) resolves the viewer/personId + db EXACTLY as `hub/profile/page.tsx`
 * does (getRuntime → auth.getCurrentAuthContext, requiring `kind === "account"`), then renders the
 * matched section's Component with this shape. A section is an async server component:
 *
 *   export default async function XSection({ personId, db, viewer }: AccountSectionProps) { ... }
 *
 * Kept in its own module (not `account-sections.ts`) so a section stub can import ONLY the type
 * without pulling the registry — which imports every section — into a cycle.
 */
import type { Database } from "@chronicle/db";

/** The resolved account auth context — `getCurrentAuthContext()` narrowed to `kind === "account"`. */
export type AccountViewer = { readonly kind: "account"; readonly personId: string };

export interface AccountSectionProps {
  /** The signed-in viewer's Person id (=== viewer.personId; passed directly for convenience). */
  personId: string;
  /** The Drizzle database handle from `getRuntime()`, exactly as the hub pages use it. */
  db: Database;
  /** The resolved account auth context (kind: "account"). */
  viewer: AccountViewer;
}
