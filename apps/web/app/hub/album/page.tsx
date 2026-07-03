/**
 * /hub/album — the Family album grid (ADR-0009 · #15).
 *
 * A server component: it resolves the viewer's family (their sole active family for #15; a
 * deterministic pick when they're in several — the #16 family picker replaces that) and lists that
 * album's photos through the album front door (`listAlbumPhotos`, which enforces active membership).
 * Each tile points at the audited bytes route (`/api/album-photo/[photoId]`), which re-checks
 * authorization on every request. A text-less, photo-less album shows an empty note, not a spinner.
 *
 * Auth: account only, gated like the rest of the hub (anonymous → landing; family-less /
 * not-onboarded → the step they still owe).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { listActiveMembershipsForPerson, listAlbumPhotos } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { AlbumUploader } from "./AlbumUploader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AlbumPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  // #15: single album — the viewer's sole active family, or a deterministic pick if they're in
  // several. #16 turns this into a picker.
  const memberships = await listActiveMembershipsForPerson(db, ctx.personId);
  const familyId = memberships
    .map((m) => m.familyId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];

  const photos = familyId ? await listAlbumPhotos(db, ctx, familyId) : [];

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
          href="/hub?tab=stories"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            textDecoration: "none",
          }}
        >
          {hub.compose.backToStories}
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

        {photos.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-md)",
              color: "var(--text-meta)",
              margin: "0 0 24px",
            }}
          >
            {hub.album.empty}
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 24px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {photos.map((photo) => (
              <li key={photo.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our
                    audited auth route, not a static asset; next/image would proxy/optimize it. */}
                <img
                  src={`/api/album-photo/${photo.id}`}
                  alt={hub.album.photoAlt(photo.caption)}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: 8,
                    display: "block",
                    background: "var(--surface-sunken, #eee)",
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {familyId ? <AlbumUploader /> : null}
      </div>
    </main>
  );
}
