/**
 * DEV-ONLY seed page. Wipes the local PGlite DB and recreates a small, click-through-ready
 * dataset (see lib/dev-seed.ts). NODE_ENV guards the page and the action.
 *
 * After a reseed, the ONLY surfaced entry point is sign-in: /dev/sign-in (one-click) or
 * /sign-in with the steward's credentials. Deep-links (token/approval/join) are not surfaced
 * here — they live in the JSON returned by /api/dev/seed for curl/power users.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { runSeed } from "@/lib/dev-seed";
import { ActionButton } from "@/app/_kindred/ActionButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runReseed(): Promise<void> {
  "use server";
  if (process.env.NODE_ENV === "production") return;
  await runSeed();
  redirect("/dev/seed?seeded=1");
}

export default async function DevSeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="kin-page">
        <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
          <h1 style={{ fontSize: "var(--text-display)", margin: 0 }}>Not available.</h1>
        </div>
      </main>
    );
  }
  const sp = await searchParams;
  const seededRaw = sp.seeded;
  const seeded = seededRaw === "1" || seededRaw === "true";

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <span className="kin-dev-banner">dev · localhost</span>
        <h1 style={{ fontSize: "var(--text-display)", margin: "14px 0 8px" }}>Dev seed</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--text-ui)", margin: 0 }}>
          Wipes the local PGlite database and recreates a small dataset: Eleanor (narrator), Sofia +
          Marco (members), one Boudreaux family, five approved+shared stories, and four pending
          questions for Eleanor with one recorded draft answer ready to review.
        </p>

        <form action={runReseed} style={{ marginTop: 28, maxWidth: 240 }}>
          <ActionButton type="submit" label="Reseed" fullWidth />
        </form>

        {seeded ? (
          <section
            style={{
              marginTop: 36,
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "22px 24px",
            }}
          >
            <div className="kin-eyebrow">Seeded</div>
            <h2
              style={{
                fontSize: "var(--text-story-lg)",
                margin: "10px 0 16px",
                fontFamily: "var(--font-story)",
              }}
            >
              Sign in to explore
            </h2>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <li>
                <div className="kin-muted" style={{ fontSize: 13 }}>
                  One-click switch-user (Eleanor · Sofia · Marco · Theo)
                </div>
                <Link href="/dev/sign-in" style={{ fontWeight: 600 }}>
                  → /dev/sign-in
                </Link>
              </li>
              <li>
                <div className="kin-muted" style={{ fontSize: 13 }}>
                  Or sign in with credentials — steward account
                </div>
                <span className="mono">sofia+clerk_test@example.com · password</span>{" "}
                <Link href="/sign-in" style={{ fontWeight: 600 }}>
                  → /sign-in
                </Link>
              </li>
              <li>
                <div className="kin-muted" style={{ fontSize: 13 }}>
                  Find a family · search &ldquo;Zachary&rdquo;, &ldquo;Eleanor&rdquo;,
                  &ldquo;IBM&rdquo; · Theo has a pending join request for Sofia to approve
                </div>
                <Link href="/families/find" className="mono">
                  /families/find
                </Link>
              </li>
            </ul>
            <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/dev/sign-in" style={{ flex: 1, minWidth: 160, textDecoration: "none" }}>
                <ActionButton label="Dev sign-in" variant="secondary" fullWidth />
              </Link>
              <Link href="/hub" style={{ flex: 1, minWidth: 160, textDecoration: "none" }}>
                <ActionButton label="Hub" variant="secondary" fullWidth />
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
