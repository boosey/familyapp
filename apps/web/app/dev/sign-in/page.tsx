/**
 * DEV sign-in. The default local AuthProvider is now the MOCK provider (auth-mock.ts), whose session
 * is the `chronicle_mock_session` cookie holding an Account's `auth_provider_user_id`. This page is
 * the fast "act as a seeded user" path: one button per Person sets that cookie to their Account's
 * provider id (looked up via persons.account_id → accounts) and redirects to /hub. Every Person has
 * an Account, so all seeded people appear — the inner join is just a safety filter against malformed
 * seed data, not a narrator exclusion. In production this whole route is replaced by Clerk.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { accounts, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { DEV_MOCK_SESSION_COOKIE } from "@/lib/auth-mock";
import { KindredButton } from "@/app/_kindred";
import { auth } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seeded Persons that have an Account (so they can be signed in as a hub user). */
async function listAccountPersons(db: Awaited<ReturnType<typeof getRuntime>>["db"]) {
  return db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      authProviderUserId: accounts.authProviderUserId,
    })
    .from(persons)
    .innerJoin(accounts, eq(accounts.id, persons.accountId));
}

async function signInAs(formData: FormData): Promise<void> {
  "use server";
  const authProviderUserId = String(formData.get("authProviderUserId") ?? "");
  const jar = await cookies();
  if (authProviderUserId === "") {
    jar.delete(DEV_MOCK_SESSION_COOKIE);
  } else {
    jar.set(DEV_MOCK_SESSION_COOKIE, authProviderUserId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  redirect("/hub");
}

export default async function DevSignIn() {
  const { db } = await getRuntime();
  const people = await listAccountPersons(db);
  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <span className="kin-dev-banner">{auth.devSignIn.eyebrow}</span>
        <h1 style={{ fontSize: "var(--text-display)", margin: "14px 0 8px" }}>{auth.devSignIn.title}</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--text-ui)", margin: 0 }}>
          {auth.devSignIn.body}
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 28,
            maxWidth: 320,
          }}
        >
          {people.map((p) => (
            <form key={p.id} action={signInAs}>
              <input type="hidden" name="authProviderUserId" value={p.authProviderUserId} />
              <KindredButton type="submit" label={auth.devSignIn.become(p.displayName)} fullWidth />
            </form>
          ))}

          <div style={{ marginTop: 8 }}>
            <form action={signInAs}>
              <input type="hidden" name="authProviderUserId" value="" />
              <KindredButton type="submit" label={auth.devSignIn.signOut} variant="secondary" fullWidth />
            </form>
          </div>
        </div>

        <p style={{ marginTop: 20 }}>
          <Link href="/hub" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-meta)" }}>
            {auth.devSignIn.backToHub}
          </Link>
        </p>
      </div>
    </main>
  );
}
