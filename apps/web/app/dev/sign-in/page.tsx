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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signInAs(formData: FormData): Promise<void> {
  "use server";
  const id = String(formData.get("personId") ?? "");
  const jar = await cookies();
  if (id === "") {
    jar.delete(DEV_AUTH_COOKIE_NAME);
  } else {
    jar.set(DEV_AUTH_COOKIE_NAME, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  redirect("/hub");
}

export default async function DevSignIn() {
  const { db } = await getRuntime();
  const people = await listAllPersons(db);
  return (
    <main className="screen">
      <h1>Dev sign-in</h1>
      <p className="subtle">
        Local development only. Picks which Person the hub treats you as.
      </p>
      <form action={signInAs} style={{ display: "grid", gap: "1rem" }}>
        <label>
          Sign in as
          <select name="personId">
            <option value="">(sign out)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.id.slice(0, 8)}…)
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
      <p>
        <Link href="/hub">Back to hub</Link>
      </p>
    </main>
  );
}
