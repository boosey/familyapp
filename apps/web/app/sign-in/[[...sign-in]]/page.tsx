/**
 * /sign-in — the catch-all route lets Clerk's multi-step hosted UI embed sub-routes
 * (e.g. /sign-in/factor-one, /sign-in/verify) without a 404.
 *
 * When Clerk is configured, renders the hosted <SignIn/> component with
 * `forceRedirectUrl="/auth/callback"` so every sign-in lands on our JIT-provision gate.
 * When Clerk is NOT configured (mock / CI), renders the existing email+password form
 * with identical behavior to the old page.tsx — no behavior change for the mock path.
 *
 * The `<SignIn/>` import is inside a dynamic import (`await import(...)`) so it is NEVER
 * pulled into the mock-mode module graph — mirrors the ClerkProvider pattern in layout.tsx.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/clerk-config";
import { getRuntime } from "@/lib/runtime";
import { mockSignIn } from "@/lib/auth-mock";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { KindredButton } from "@/app/_kindred";
import { AuthScreen } from "@/app/_auth/AuthScreen";
import { auth } from "@/app/_copy";

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
  if (isClerkConfigured()) {
    // Dynamic import keeps @clerk/nextjs out of the mock build's module graph.
    // Mirrors the ClerkProvider pattern in layout.tsx.
    const { SignIn } = await import("@clerk/nextjs");
    return (
      <SignIn
        forceRedirectUrl="/auth/callback"
        signUpForceRedirectUrl="/auth/callback"
        signUpUrl="/sign-up"
      />
    );
  }

  const { error } = await searchParams;
  return (
    <AuthScreen
      title={auth.signIn.title}
      subtitle={auth.signIn.subtitle}
      error={error ? auth.signIn.error : null}
      footer={
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {auth.signIn.newHere}{" "}
          <Link href="/sign-up" style={{ fontWeight: 600 }}>
            {auth.signIn.createFamily}
          </Link>
        </p>
      }
    >
      <form action={signIn} style={{ display: "grid", gap: 18 }}>
        <label className="kin-form-label">
          {auth.signIn.emailLabel}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="kin-field"
            placeholder={auth.signIn.emailPlaceholder}
          />
        </label>
        <label className="kin-form-label">
          {auth.signIn.passwordLabel}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="kin-field"
            placeholder={auth.signIn.passwordPlaceholder}
          />
        </label>
        <KindredButton type="submit" label={auth.signIn.submit} fullWidth size="large" />
      </form>
    </AuthScreen>
  );
}
