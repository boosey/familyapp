/**
 * /sign-up — the catch-all route lets Clerk's multi-step hosted UI embed sub-routes
 * (e.g. /sign-up/verify-email-address, /sign-up/continue) without a 404.
 *
 * When Clerk is configured, renders the hosted <SignUp/> component with
 * `forceRedirectUrl="/auth/callback"` so every sign-up lands on our JIT-provision gate.
 * When Clerk is NOT configured (mock / CI), renders the existing create-account form
 * with identical behavior to the old page.tsx — no behavior change for the mock path.
 *
 * The `<SignUp/>` import is inside a dynamic import (`await import(...)`) so it is NEVER
 * pulled into the mock-mode module graph — mirrors the ClerkProvider pattern in layout.tsx.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/clerk-config";
import { getRuntime } from "@/lib/runtime";
import { mockSignUp } from "@/lib/auth-mock";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { AuthScreen } from "@/app/_auth/AuthScreen";
import { auth } from "@/app/_copy";
import { kindredClerkAppearance } from "@/lib/clerk-appearance";

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
  if (isClerkConfigured()) {
    // Dynamic import keeps @clerk/nextjs out of the mock build's module graph.
    // Mirrors the ClerkProvider pattern in layout.tsx.
    const { SignUp } = await import("@clerk/nextjs");
    return (
      <AuthScreen title={auth.signUp.title} subtitle={auth.signUp.subtitle}>
        <SignUp
          appearance={kindredClerkAppearance}
          forceRedirectUrl="/auth/callback"
          signInForceRedirectUrl="/auth/callback"
          signInUrl="/sign-in"
        />
      </AuthScreen>
    );
  }

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
        <ActionButton type="submit" label={auth.signUp.submit} fullWidth />
      </form>
    </AuthScreen>
  );
}
