/**
 * /families/start — the create-or-join fork for an onboarded Person who belongs to no family yet
 * (the manual-signup path; invited users already have a family via their accepted invite).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { listActiveMembershipsForPerson } from "@chronicle/core";
import { families } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Door({
  href,
  icon,
  title,
  body,
  primary,
}: {
  href: string;
  icon: string;
  title: string;
  body: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        textDecoration: "none",
        background: primary ? "var(--accent-soft)" : "var(--surface-card)",
        border: `var(--border-width) solid ${primary ? "var(--accent)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-xl)",
        boxShadow: primary ? "var(--shadow-card)" : "var(--shadow-sm)",
        padding: "clamp(24px, 4vw, 36px)",
      }}
    >
      <div aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>
        {icon}
      </div>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "10px 0 8px",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          margin: 0,
          lineHeight: "var(--leading-body)",
        }}
      >
        {body}
      </p>
    </Link>
  );
}

export default async function FamiliesStartPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  // Already in a family? Nothing to choose — go to the hub.
  const active = await listActiveMembershipsForPerson(db, ctx.personId);
  if (active.length > 0) redirect("/hub");

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page)",
        padding: "clamp(24px, 5vw, 56px) 16px",
      }}
    >
      <div style={{ maxWidth: 720, width: "100%" }}>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-display)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 8px",
            lineHeight: "var(--leading-tight)",
          }}
        >
          {families.start.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-muted)",
            margin: "0 0 32px",
            lineHeight: "var(--leading-body)",
          }}
        >
          {families.start.intro}
        </p>
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          <Door
            href="/families/new"
            icon={families.start.freshIcon}
            title={families.start.freshTitle}
            body={families.start.freshBody}
            primary
          />
          <Door
            href="/families/find"
            icon={families.start.joinIcon}
            title={families.start.joinTitle}
            body={families.start.joinBody}
          />
        </div>
      </div>
    </main>
  );
}
