/**
 * DEV sign-in. The default local AuthProvider is now the MOCK provider (auth-mock.ts), whose session
 * is the `chronicle_mock_session` cookie holding an Account's `auth_provider_user_id`. This page is
 * the fast "act as a seeded user" path: pick a Person, and we set that cookie to their Account's
 * provider id (looked up via persons.account_id → accounts). Persons without an Account (elders) are
 * not listed — they never sign in to the hub. In production this whole route is replaced by Clerk.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { accounts, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { DEV_MOCK_SESSION_COOKIE } from "@/lib/auth-mock";
import { KindredButton } from "@/app/_kindred";

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
        <span className="kin-dev-banner">dev · localhost</span>
        <h1 style={{ fontSize: "var(--text-display)", margin: "14px 0 8px" }}>Dev sign-in</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--text-ui)", margin: 0 }}>
          Local development only. Picks which Person the hub treats you as (sets the mock session).
        </p>

        <form action={signInAs} style={{ display: "grid", gap: 20, marginTop: 28 }}>
          <label className="kin-form-label">
            Sign in as
            <select name="authProviderUserId" className="kin-field">
              <option value="">(sign out)</option>
              {people.map((p) => (
                <option key={p.id} value={p.authProviderUserId}>
                  {p.displayName} ({p.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </label>
          <KindredButton type="submit" label="Apply" />
        </form>

        <p style={{ marginTop: 20 }}>
          <Link href="/hub" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-meta)" }}>
            ‹ Back to hub
          </Link>
        </p>
      </div>
    </main>
  );
}
