/**
 * Shows the newly-minted elder invite link ONCE. The raw token arrives via a short-lived,
 * httpOnly flash cookie (set by the invite server action) and is read + cleared here. We
 * deliberately do NOT pass the token via URL query string: that would leak the secret into
 * server logs, browser history, and the Referer header on any outbound click.
 *
 * The DB stores only the sha-256 hash. If the inviter loses this page, the only recovery is to
 * mint a new link.
 */
import { cookies, headers } from "next/headers";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASH_COOKIE = "chronicle_flash_invite_token";

export default async function InviteResult() {
  const jar = await cookies();
  const token = jar.get(FLASH_COOKIE)?.value;
  // Clear immediately — single-view, like a flash message. (Reads on F5 will be empty.)
  if (token) jar.delete(FLASH_COOKIE);

  if (!token) {
    return (
      <main className="screen">
        <p>
          No link to show. <Link href="/hub/invite">Mint a new one</Link>.
        </p>
      </main>
    );
  }

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const link = `${proto}://${host}/s/${token}`;

  return (
    <main className="screen">
      <h1>Link is ready</h1>
      <p className="subtle">
        Send this to your elder however you usually talk — text or email.
        Tapping it opens their recording page directly. There is no password.
      </p>
      <p>
        <code style={{ wordBreak: "break-all" }}>{link}</code>
      </p>
      <p className="subtle">
        This page shows the link only once. Save it now if you need to send it
        later — refreshing this page will clear it.
      </p>
      <p>
        <Link href="/hub">Back to hub</Link>
      </p>
    </main>
  );
}
