/**
 * /hub/settings — device-local app preferences (text size, color palette).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { SettingsPanel } from "./SettingsPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest === "/welcome") redirect(dest);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "20px clamp(16px, 4vw, 32px) 48px",
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/hub"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {hub.settings.backToHub}
        </Link>

        <header style={{ marginTop: 24, marginBottom: 32 }}>
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "clamp(1.75rem, 4vw, var(--text-display))",
              fontWeight: 400,
              color: "var(--text-body)",
              margin: "0 0 8px",
            }}
          >
            {hub.settings.title}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: "var(--leading-snug)",
            }}
          >
            {hub.settings.subtitle}
          </p>
        </header>

        <SettingsPanel />
      </div>
    </main>
  );
}
