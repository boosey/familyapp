/**
 * Whether /dev/* click-through surfaces (seed, prototypes, …) should be reachable.
 *
 * Vercel preview builds set NODE_ENV=production, so gating on NODE_ENV alone hides
 * prototypes on the exact URLs reviewers open. Allow preview + local; block only
 * true production (VERCEL_ENV=production) or a non-Vercel production Node build.
 */
export function isDevSurfaceEnabled(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return false;
  if (vercelEnv === "preview" || vercelEnv === "development") return true;
  return process.env.NODE_ENV !== "production";
}
