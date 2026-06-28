/**
 * /sign-in — verify credentials via the mock auth provider, then hand off to resolvePostAuthRoute
 * (onboarding gate → family gate → hub). invalid_credentials surfaces inline via ?error=.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { mockSignIn } from "@/lib/auth-mock";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { KindredButton } from "@/app/_kindred";
import { AuthScreen } from "@/app/_auth/AuthScreen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signIn(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    redirect("/sign-in?error=invalid_credentials");
  }
  const { db } = await getRuntime();
  const res = await mockSignIn(db, { email, password });
  if (!res.ok) {
    redirect("/sign-in?error=invalid_credentials");
  }
  redirect(await resolvePostAuthRoute(db, res.personId));
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to see your family's stories."
      error={error ? "That email and password don't match. Please try again." : null}
      footer={
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          New here?{" "}
          <Link href="/sign-up" style={{ fontWeight: 600 }}>
            Create your family
          </Link>
        </p>
      }
    >
      <form action={signIn} style={{ display: "grid", gap: 18 }}>
        <label className="kin-form-label">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="kin-field"
            placeholder="you@example.com"
          />
        </label>
        <label className="kin-form-label">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="kin-field"
            placeholder="Your password"
          />
        </label>
        <KindredButton type="submit" label="Sign in" fullWidth size="large" />
      </form>
    </AuthScreen>
  );
}
