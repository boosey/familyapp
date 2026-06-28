/**
 * /sign-up — create a Account+Person via the mock auth provider. A fresh account
 * is never onboarded, so resolvePostAuthRoute always lands a new signup on /welcome. Inline errors
 * (email already taken / invalid input) come back through the ?error= searchParam — the server
 * action redirects to itself on failure so there is no client boundary here.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { mockSignUp } from "@/lib/auth-mock";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { KindredButton } from "@/app/_kindred";
import { AuthScreen } from "@/app/_auth/AuthScreen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signUp(formData: FormData): Promise<void> {
  "use server";
  const displayName = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!displayName || !email || !password) {
    redirect("/sign-up?error=invalid");
  }
  const { db } = await getRuntime();
  const res = await mockSignUp(db, { email, password, displayName });
  if (!res.ok) {
    redirect(`/sign-up?error=${res.error}`);
  }
  redirect(await resolvePostAuthRoute(db, res.personId));
}

const ERRORS: Record<string, string> = {
  email_taken: "That email already has an account. Try signing in instead.",
  invalid: "Please fill in your name, email, and a password.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthScreen
      title="Create your family"
      subtitle="Start a space for your family's stories. You can invite relatives and narrators once you're in."
      error={error ? ERRORS[error] ?? null : null}
      footer={
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          Already have an account?{" "}
          <Link href="/sign-in" style={{ fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      }
    >
      <form action={signUp} style={{ display: "grid", gap: 18 }}>
        <label className="kin-form-label">
          Your name
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="kin-field"
            placeholder="Sofia Boudreaux"
          />
        </label>
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
            autoComplete="new-password"
            required
            className="kin-field"
            placeholder="Choose a password"
          />
        </label>
        <KindredButton type="submit" label="Create account" fullWidth size="large" />
      </form>
    </AuthScreen>
  );
}
