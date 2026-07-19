/**
 * /join/[token] — accept a family-member invitation (asks #3 + #6, handoff Screen 1).
 *
 * The token in the path IS the invite (mirrors the narrator /s/[token] surface); it's shown once via
 * the inviter's flash-cookie and never echoed into a query/redirect. We look the invite up by token
 * for a safe view (no email leak), then either let an anonymous visitor create a login and accept,
 * or — if already signed in — accept directly. Both paths edit only the free-text relationship label
 * (re-picking a different person is out of scope), then continue to /welcome (DOB onward).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime, isClerkConfigured } from "@/lib/runtime";
import { acceptInvitation, getInvitationByToken } from "@chronicle/core";
import { mockSignUp } from "@/lib/auth-mock";
import { beginClerkJoinAction } from "@/lib/join-actions";
import { KindredButton } from "@/app/_kindred";
import { join } from "@/app/_copy";
import styles from "@/app/_onboarding/onboarding-card.module.css";

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

async function beginClerkJoin(formData: FormData): Promise<void> {
  "use server";
  const tok = String(formData.get("token") ?? "");
  const label = String(formData.get("relationshipLabel") ?? "").trim();
  await beginClerkJoinAction(tok, label || undefined);
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
  email_taken: join.errorEmailTaken,
  invalid: join.errorMissing,
  accept: join.errorInviteUsed,
};

function Shell({ children }: { children: React.ReactNode }) {
  // The join card is narrower than the 560px onboarding default; --card-max is a one-off layout number
  // (CSS-MODULES rule 6) consumed by .card as max-width.
  return (
    <main className={styles.page}>
      <div className={styles.card} style={{ "--card-max": "480px" } as React.CSSProperties}>
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
          className={styles.headline}
          style={{ fontSize: "var(--text-story-lg)", margin: "0 0 10px" }}
        >
          {join.invalidTitle}
        </h1>
        <p className={styles.sub} style={{ margin: "0 0 24px" }}>
          {join.invalidBody}
        </p>
        <Link href="/sign-in" style={{ textDecoration: "none" }}>
          <KindredButton label={join.signIn} fullWidth />
        </Link>
      </Shell>
    );
  }

  const ctx = await auth.getCurrentAuthContext();
  const clerk = isClerkConfigured();
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
          {join.fromTheInvite}
        </div>
        <div
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story)",
            color: "var(--text-body)",
          }}
        >
          {inviteeName || join.aNewRelative}
        </div>
      </div>
    </div>
  );

  const heading = (
    <>
      <div className={styles.eyebrow}>{join.invitationEyebrow}</div>
      <h1
        className={styles.headline}
        style={{ fontSize: "var(--text-story-lg)", margin: "12px 0 6px", lineHeight: "var(--leading-snug)" }}
      >
        {join.invitedYou(invite.inviterName, invite.familyName)}
      </h1>
      <p className={styles.sub} style={{ margin: "0 0 22px" }}>
        {join.confirm}
      </p>
    </>
  );

  const errorBox = error ? (
    <p role="alert" className={styles.errorBox} style={{ margin: "0 0 20px" }}>
      {SIGNUP_ERRORS[error] ?? join.genericError}
    </p>
  ) : null;

  const relationshipField = (
    <label className="kin-form-label">
      {join.relationshipLabel} <span style={{ fontWeight: 400 }}>{join.relationshipLabelHint}</span>
      <input
        name="relationshipLabel"
        type="text"
        defaultValue={relationship}
        className="kin-field"
        placeholder={join.relationshipPlaceholder}
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
          <KindredButton type="submit" label={join.comeIn} fullWidth size="large" />
        </form>
      </Shell>
    );
  }

  /* ── Anonymous + Clerk configured: stash invite cookie, hand off to Clerk sign-up ── */
  if (clerk) {
    return (
      <Shell>
        {heading}
        {identityCard}
        {errorBox}
        {/* Clerk collects name / email / password — we only need the relationship label up front. */}
        <form action={beginClerkJoin} style={{ display: "grid", gap: 18, marginTop: 14 }}>
          <input type="hidden" name="token" value={token} />
          {relationshipField}
          <KindredButton type="submit" label={join.clerkContinue} fullWidth size="large" />
        </form>
      </Shell>
    );
  }

  /* ── Anonymous + no Clerk (mock): create a login, then accept ──────────────── */
  return (
    <Shell>
      {heading}
      {identityCard}
      {errorBox}
      <form action={signUpAndAccept} style={{ display: "grid", gap: 18, marginTop: 14 }}>
        <input type="hidden" name="token" value={token} />
        {relationshipField}
        <label className="kin-form-label">
          {join.nameLabel}
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
          {join.emailLabel}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="kin-field"
            placeholder={join.emailPlaceholder}
          />
        </label>
        <label className="kin-form-label">
          {join.passwordLabel}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className="kin-field"
            placeholder={join.passwordPlaceholder}
          />
        </label>
        <KindredButton type="submit" label={join.submit} fullWidth size="large" />
      </form>
    </Shell>
  );
}
