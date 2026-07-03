/**
 * /hub/album — the Family album grid (ADR-0009 · #15 · #16).
 *
 * A server component: it resolves which family album is on screen (the `?family=` context, falling
 * back to the viewer's first active family) and lists that album's photos through the album front
 * door (`listAlbumPhotos`, which enforces active membership). Each tile points at the audited bytes
 * route (`/api/album-photo/[photoId]`), which re-checks authorization on every request. A photo-less
 * album shows an empty note, not a spinner.
 *
 * #16 — a contributor in >=2 families gets a family switcher atop the grid (view each album) plus a
 * multi-family placement picker in the uploader; the switcher's current family is the context the
 * uploader defaults its selection to.
 *
 * Auth: account only, gated like the rest of the hub (anonymous → landing; family-less /
 * not-onboarded → the step they still owe).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { listActiveFamiliesForPerson, listAlbumPhotos } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { AlbumUploader } from "./AlbumUploader";

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

  // #16: the album on screen is the `?family=` context (re-validated against the viewer's OWN active
  // families), falling back to their first active family. `current` is undefined only when they have
  // no active membership.
  const active = await listActiveFamiliesForPerson(db, ctx.personId);
  const params = await searchParams;
  const requested = typeof params.family === "string" ? params.family : undefined;
  const current = active.find((f) => f.familyId === requested) ?? active[0];

  const photos = current ? await listAlbumPhotos(db, ctx, current.familyId) : [];

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

        {active.length > 1 ? (
          <nav
            aria-label={hub.album.switcherAria}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              margin: "0 0 24px",
            }}
          >
            {active.map((f) => {
              const isCurrent = current?.familyId === f.familyId;
              return (
                <Link
                  key={f.familyId}
                  href={`/hub/album?family=${encodeURIComponent(f.familyId)}`}
                  aria-current={isCurrent ? "page" : undefined}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    padding: "8px 14px",
                    borderRadius: 999,
                    textDecoration: "none",
                    border: "1px solid var(--border-subtle, #ddd)",
                    background: isCurrent
                      ? "var(--accent, #333)"
                      : "var(--surface-raised, transparent)",
                    color: isCurrent
                      ? "var(--on-accent, #fff)"
                      : "var(--text-meta)",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {f.familyName}
                </Link>
              );
            })}
          </nav>
        ) : null}

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

        {current ? (
          <AlbumUploader families={active} currentFamilyId={current.familyId} />
        ) : null}
      </div>
    </main>
  );
}
