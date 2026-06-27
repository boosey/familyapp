/**
 * DEV-ONLY seed page. Wipes the local PGlite DB and recreates a small, click-through-ready
 * dataset (see lib/dev-seed.ts). NODE_ENV guards the page and the action.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { runSeed } from "@/lib/dev-seed";
import { KindredButton } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runReseed(): Promise<void> {
  "use server";
  if (process.env.NODE_ENV === "production") return;
  const { elderToken, pendingStoryId } = await runSeed();
  redirect(
    `/dev/seed?token=${encodeURIComponent(elderToken)}&pending=${encodeURIComponent(pendingStoryId)}`,
  );
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
  const tokenRaw = sp.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  const pendingRaw = sp.pending;
  const pendingStoryId = Array.isArray(pendingRaw) ? pendingRaw[0] : pendingRaw;
  const elderUrl = token ? `/s/${token}` : null;
  const approvalUrl = token && pendingStoryId ? `/s/${token}/approve/${pendingStoryId}` : null;

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <span className="kin-dev-banner">dev · localhost</span>
        <h1 style={{ fontSize: "var(--text-display)", margin: "14px 0 8px" }}>Dev seed</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--text-ui)", margin: 0 }}>
          Wipes the local PGlite database and recreates a small dataset: Eleanor (elder), Sofia +
          Marco (members), one Boudreaux family, one approved+shared sample story, and one
          pending-approval story.
        </p>

        <form action={runReseed} style={{ marginTop: 28, maxWidth: 240 }}>
          <KindredButton type="submit" label="Reseed" fullWidth />
        </form>

        {elderUrl ? (
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
            <h2 style={{ fontSize: "var(--text-story-lg)", margin: "10px 0 16px", fontFamily: "var(--font-story)" }}>
              Try the flow
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              <li>
                <div className="kin-muted" style={{ fontSize: 13 }}>Elder link (Eleanor)</div>
                <Link href={elderUrl} className="mono" style={{ wordBreak: "break-all" }}>{elderUrl}</Link>
              </li>
              {approvalUrl ? (
                <li>
                  <div className="kin-muted" style={{ fontSize: 13 }}>Pending-approval story</div>
                  <Link href={approvalUrl} className="mono" style={{ wordBreak: "break-all" }}>{approvalUrl}</Link>
                </li>
              ) : null}
            </ul>
            <p className="kin-muted" style={{ fontSize: 13, marginTop: 16 }}>
              One-time token; it's in the URL only because this is a localhost dev tool. The real
              invite flow uses an httpOnly flash cookie.
            </p>
            <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/dev/sign-in" style={{ flex: 1, minWidth: 160, textDecoration: "none" }}>
                <KindredButton label="Dev sign-in" variant="secondary" fullWidth />
              </Link>
              <Link href="/hub" style={{ flex: 1, minWidth: 160, textDecoration: "none" }}>
                <KindredButton label="Hub" variant="secondary" fullWidth />
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
