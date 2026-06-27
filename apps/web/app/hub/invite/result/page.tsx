/**
 * Shows the newly-minted elder invite link ONCE. The raw token arrives via a short-lived,
 * httpOnly flash cookie (set by the invite server action) and is read + cleared here. The token
 * is never passed via URL query string — that would leak the secret into server logs, browser
 * history, and the Referer header on any outbound click.
 */
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { KindredButton, KindredPromptCard } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASH_COOKIE = "chronicle_flash_invite_token";

export default async function InviteResult() {
  const jar = await cookies();
  const token = jar.get(FLASH_COOKIE)?.value;
  if (token) jar.delete(FLASH_COOKIE);

  if (!token) {
    return (
      <main className="kin-page">
        <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>No link to show</h1>
          <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)" }}>
            Mint a new one whenever you're ready.
          </p>
          <Link href="/hub/invite" style={{ textDecoration: "none", display: "inline-block", maxWidth: 260, marginTop: 16 }}>
            <KindredButton label="New invite link" />
          </Link>
        </div>
      </main>
    );
  }

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const link = `${proto}://${host}/s/${token}`;

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Link is ready</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", marginTop: 8 }}>
          Send this to your elder however you usually talk — text or email. Tapping it opens their
          recording page directly. There is no password.
        </p>

        <div style={{ marginTop: 28 }}>
          <KindredPromptCard
            eyebrow="The link (shown once)"
            question={
              <code
                style={{
                  fontFamily: "var(--kin-font-mono)",
                  fontSize: "var(--kin-text-h3)",
                  wordBreak: "break-all",
                  color: "var(--kin-ink)",
                }}
              >
                {link}
              </code>
            }
          />
        </div>

        <p className="kin-muted" style={{ fontSize: "var(--kin-text-sm)", marginTop: 18 }}>
          This page shows the link only once. Save it now if you need to send it later — refreshing
          this page will clear it.
        </p>

        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/hub" style={{ textDecoration: "none", flex: 1, minWidth: 200 }}>
            <KindredButton label="Back to hub" variant="secondary" />
          </Link>
        </div>
      </div>
    </main>
  );
}
