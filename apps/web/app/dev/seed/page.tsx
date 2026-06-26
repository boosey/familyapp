/**
 * DEV-ONLY seed page. Wipes the local PGlite DB and recreates a small, click-through-ready
 * dataset (see lib/dev-seed.ts). NODE_ENV guards the page and the action.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { runSeed } from "@/lib/dev-seed";

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
      <main className="screen">
        <h1>Not available.</h1>
      </main>
    );
  }
  const sp = await searchParams;
  const tokenRaw = sp.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  const pendingRaw = sp.pending;
  const pendingStoryId = Array.isArray(pendingRaw) ? pendingRaw[0] : pendingRaw;
  const elderUrl = token ? `/s/${token}` : null;
  const approvalUrl =
    token && pendingStoryId ? `/s/${token}/approve/${pendingStoryId}` : null;

  return (
    <main className="screen">
      <h1>Dev seed</h1>
      <p className="subtle">
        Wipes the local PGlite database and recreates a small dataset: Eleanor
        (elder), Sofia + Marco (members), one Boudreaux family, one
        approved+shared sample story, and one pending-approval story.
      </p>
      <form action={runReseed}>
        <button className="big-button" type="submit">
          Reseed
        </button>
      </form>
      {elderUrl ? (
        <section style={{ marginTop: "2rem", maxWidth: "40rem" }}>
          <h2>Seeded.</h2>
          <p>Elder link (Eleanor):</p>
          <p>
            <Link href={elderUrl}>{elderUrl}</Link>
          </p>
          {approvalUrl ? (
            <>
              <p>Pending-approval story (elder approval UI):</p>
              <p>
                <Link href={approvalUrl}>{approvalUrl}</Link>
              </p>
            </>
          ) : null}
          <p className="subtle">
            (One-time token; it is in the URL only because this is a localhost
            dev tool. The real invite flow uses an httpOnly flash cookie.)
          </p>
          <p>
            <Link href="/dev/sign-in">Dev sign-in</Link> · <Link href="/hub">Hub</Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
