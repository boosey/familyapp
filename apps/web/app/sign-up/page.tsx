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
import { auth } from "@/app/_copy";

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
  email_taken: auth.signUp.errorEmailTaken,
  invalid: auth.signUp.errorMissing,
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthScreen
      title={auth.signUp.title}
      subtitle={auth.signUp.subtitle}
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
          {auth.signUp.haveAccount}{" "}
          <Link href="/sign-in" style={{ fontWeight: 600 }}>
            {auth.signUp.signIn}
          </Link>
        </p>
      }
    >
      <form action={signUp} style={{ display: "grid", gap: 18 }}>
        <label className="kin-form-label">
          {auth.signUp.nameLabel}
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="kin-field"
            placeholder={auth.signUp.namePlaceholder}
          />
        </label>
        <label className="kin-form-label">
          {auth.signUp.emailLabel}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="kin-field"
            placeholder={auth.signUp.emailPlaceholder}
          />
        </label>
        <label className="kin-form-label">
          {auth.signUp.passwordLabel}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className="kin-field"
            placeholder={auth.signUp.passwordPlaceholder}
          />
        </label>
        <KindredButton type="submit" label={auth.signUp.submit} fullWidth size="large" />
      </form>
    </AuthScreen>
  );
}
