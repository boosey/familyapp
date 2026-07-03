/**
 * /hub/album — the Family album, as a standalone deep-link route (ADR-0009 · #15–#18 · #19).
 *
 * The album surface itself lives in the shared `AlbumSurface` component, mounted here AND in the hub's
 * 'Album' tab (`/hub?tab=album`). This route contributes only the page chrome — `<main>`, the
 * container, the back-link (to the album's tab home), and the `<h1>` — and hands the `?family=`
 * context to the surface, which does its own audited reads.
 *
 * Auth: account only, gated like the rest of the hub (anonymous → landing; family-less /
 * not-onboarded → the step they still owe).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { AlbumSurface } from "./AlbumSurface";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AlbumPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  const params = await searchParams;
  const requested = typeof params.family === "string" ? params.family : undefined;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "20px clamp(16px, 4vw, 32px) 40px",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/hub?tab=album"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            textDecoration: "none",
          }}
        >
          {hub.album.backToAlbum}
        </Link>

        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-display-sm)",
            color: "var(--text-strong)",
            margin: "16px 0 24px",
          }}
        >
          {hub.album.title}
        </h1>

        <AlbumSurface
          db={db}
          ctx={ctx}
          requestedFamily={requested}
          familyHref={(id) => `/hub/album?family=${encodeURIComponent(id)}`}
        />
      </div>
    </main>
  );
}
