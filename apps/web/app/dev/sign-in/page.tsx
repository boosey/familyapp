/**
 * DEV sign-in. The local AuthProvider is a cookie that maps to a Person id; this page lets a
 * developer pick a Person to act as. In production this whole route is replaced by Clerk's
 * sign-in flow and the cookie name is unused.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { listAllPersons } from "@/lib/hub-data";
import { DEV_AUTH_COOKIE_NAME } from "@/lib/auth";
import { KindredButton } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signInAs(formData: FormData): Promise<void> {
  "use server";
  const id = String(formData.get("personId") ?? "");
  const jar = await cookies();
  if (id === "") {
    jar.delete(DEV_AUTH_COOKIE_NAME);
  } else {
    jar.set(DEV_AUTH_COOKIE_NAME, id, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  redirect("/hub");
}

export default async function DevSignIn() {
  const { db } = await getRuntime();
  const people = await listAllPersons(db);
  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <span className="kin-dev-banner">dev · localhost</span>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: "14px 0 8px" }}>Dev sign-in</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", margin: 0 }}>
          Local development only. Picks which Person the hub treats you as.
        </p>

        <form action={signInAs} style={{ display: "grid", gap: 20, marginTop: 28 }}>
          <label className="kin-form-label">
            Sign in as
            <select name="personId" className="kin-field">
              <option value="">(sign out)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </label>
          <KindredButton type="submit" label="Apply" />
        </form>

        <p style={{ marginTop: 20 }}>
          <Link href="/hub" style={{ fontSize: 15, fontWeight: 600, color: "var(--kin-ink-2)" }}>
            ‹ Back to hub
          </Link>
        </p>
      </div>
    </main>
  );
}
