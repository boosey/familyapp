/**
 * /join/[token] — accept a family-member invitation (asks #3 + #6, handoff Screen 1).
 *
 * The token in the path IS the invite (mirrors the elder /s/[token] surface); it's shown once via
 * the inviter's flash-cookie and never echoed into a query/redirect. We look the invite up by token
 * for a safe view (no email leak), then either let an anonymous visitor create a login and accept,
 * or — if already signed in — accept directly. Both paths edit only the free-text relationship label
 * (re-picking a different person is out of scope), then continue to /welcome (DOB onward).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { acceptInvitation, getInvitationByToken } from "@chronicle/core";
import { mockSignUp } from "@/lib/auth-mock";
import { KindredButton } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function acceptAsSignedIn(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  const token = String(formData.get("token") ?? "");
  const relationshipLabel = String(formData.get("relationshipLabel") ?? "").trim();
  if (ctx.kind !== "account") redirect("/sign-in");
  try {
    await acceptInvitation(db, {
      token,
      acceptedPersonId: ctx.personId,
      relationshipLabel: relationshipLabel || undefined,
    });
  } catch {
    redirect(`/join/${token}?error=accept`);
  }
  redirect("/welcome?from=invite");
}

async function signUpAndAccept(formData: FormData): Promise<void> {
  "use server";
  const { db } = await getRuntime();
  const token = String(formData.get("token") ?? "");
  const displayName = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const relationshipLabel = String(formData.get("relationshipLabel") ?? "").trim();
  if (!displayName || !email || !password) redirect(`/join/${token}?error=invalid`);

  const res = await mockSignUp(db, { email, password, displayName });
  if (!res.ok) redirect(`/join/${token}?error=${res.error}`);

  try {
    await acceptInvitation(db, {
      token,
      acceptedPersonId: res.personId,
      relationshipLabel: relationshipLabel || undefined,
    });
  } catch {
    redirect(`/join/${token}?error=accept`);
  }
  redirect("/welcome?from=invite");
}

const SIGNUP_ERRORS: Record<string, string> = {
  email_taken: "That email already has an account. Sign in first, then open this link again.",
  invalid: "Please fill in your name, email, and a password.",
  accept: "We couldn't complete the invite — it may have just been used or expired.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page)",
        padding: "clamp(24px, 5vw, 48px) 16px",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          padding: "clamp(28px, 5vw, 48px)",
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        {children}
      </div>
    </main>
  );
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const { db, auth } = await getRuntime();

  const invite = await getInvitationByToken(db, token);

  /* ── Invalid / used / expired ────────────────────────────────────────────── */
  if (!invite || invite.status !== "pending" || invite.expired) {
    return (
      <Shell>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 10px",
          }}
        >
          This invite is no longer valid
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            lineHeight: "var(--leading-body)",
            margin: "0 0 24px",
          }}
        >
          It may have already been used, or it expired. Ask whoever invited you to send a fresh link
          — or sign in if you already have an account.
        </p>
        <Link href="/sign-in" style={{ textDecoration: "none" }}>
          <KindredButton label="Sign in" fullWidth />
        </Link>
      </Shell>
    );
  }

  const ctx = await auth.getCurrentAuthContext();
  const inviteeName = invite.inviteeName ?? "";
  const relationship = invite.relationshipLabel ?? "";

  const identityCard = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "var(--surface-sunken)",
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "16px 18px",
        margin: "0 0 8px",
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--support)",
          color: "var(--accent-on)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-story)",
          fontSize: "1.25rem",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {(inviteeName || "?").charAt(0).toUpperCase()}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "var(--tracking-mono)",
            color: "var(--support)",
          }}
        >
          FROM THE INVITE
        </div>
        <div
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story)",
            color: "var(--text-body)",
          }}
        >
          {inviteeName || "A new relative"}
        </div>
      </div>
    </div>
  );

  const heading = (
    <>
      <div className="kin-eyebrow">An invitation</div>
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "12px 0 6px",
          lineHeight: "var(--leading-snug)",
        }}
      >
        {invite.inviterName} invited you to the {invite.familyName} family.
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          lineHeight: "var(--leading-body)",
          margin: "0 0 22px",
        }}
      >
        Confirm who you are and come on in.
      </p>
    </>
  );

  const errorBox = error ? (
    <p
      role="alert"
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-ui-sm)",
        color: "var(--accent-strong)",
        background: "var(--accent-soft)",
        border: "var(--border-width) solid var(--accent)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        margin: "0 0 20px",
      }}
    >
      {SIGNUP_ERRORS[error] ?? "Something went wrong. Please try again."}
    </p>
  ) : null;

  const relationshipField = (
    <label className="kin-form-label">
      Your relationship <span style={{ fontWeight: 400 }}>(edit if it&apos;s not quite right)</span>
      <input
        name="relationshipLabel"
        type="text"
        defaultValue={relationship}
        className="kin-field"
        placeholder="e.g. Rosa's father"
      />
    </label>
  );

  /* ── Already signed in: accept directly ──────────────────────────────────── */
  if (ctx.kind === "account") {
    return (
      <Shell>
        {heading}
        {identityCard}
        {errorBox}
        <form action={acceptAsSignedIn} style={{ display: "grid", gap: 18, marginTop: 14 }}>
          <input type="hidden" name="token" value={token} />
          {relationshipField}
          <KindredButton type="submit" label="Come in" fullWidth size="large" />
        </form>
      </Shell>
    );
  }

  /* ── Anonymous: create a login, then accept ──────────────────────────────── */
  return (
    <Shell>
      {heading}
      {identityCard}
      {errorBox}
      <form action={signUpAndAccept} style={{ display: "grid", gap: 18, marginTop: 14 }}>
        <input type="hidden" name="token" value={token} />
        {relationshipField}
        <label className="kin-form-label">
          Your name
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="kin-field"
            defaultValue={inviteeName}
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
          Create a password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className="kin-field"
            placeholder="Choose a password"
          />
        </label>
        <KindredButton type="submit" label="Create login & come in" fullWidth size="large" />
      </form>
    </Shell>
  );
}
