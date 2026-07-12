/**
 * /hub/profile — post-onboarding identity and biographical anchor editor.
 *
 * First-time intake stays at /hub/about-you; this surface is for later edits from the account menu.
 * Fields auto-save on blur (booleans on change). Email is read-only from the linked Account.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import type { BiographicalProfile } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { ProfileForm } from "./ProfileForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest === "/welcome") redirect(dest);

  const [row] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      birthDate: persons.birthDate,
      biographicalAnchors: persons.biographicalAnchors,
      email: accounts.email,
    })
    .from(persons)
    .leftJoin(accounts, eq(persons.accountId, accounts.id))
    .where(eq(persons.id, ctx.personId))
    .limit(1);

  if (!row) redirect("/hub");

  const anchors = (row.biographicalAnchors ?? {}) as Partial<BiographicalProfile>;

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
        <Link href="/hub" style={backLink}>
          {hub.profile.backToHub}
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
            {hub.profile.title}
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
            {hub.profile.subtitle}
          </p>
        </header>

        <ProfileForm
          displayName={row.displayName ?? ""}
          spokenName={row.spokenName ?? ""}
          email={row.email}
          birthDate={row.birthDate}
          anchors={anchors}
        />
      </div>
    </main>
  );
}

const backLink: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-meta)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
