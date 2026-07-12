/**
 * Kin surface (issue #32) — view your relatives in the current family + add one.
 *
 * Server component. Resolves the viewer, resolves the CURRENT family from the hub's single `?scope=`
 * param (validated against the viewer's OWN active families, falling back to their first active
 * family — the same rule the rest of the hub uses), then lists the viewer's derived kin via the
 * audited core read `listMyKin`. All person names come from `listMyKin` (which hydrates them behind
 * the kinship front door) — this page never queries `persons` itself.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  listActiveFamiliesForPerson,
  listMyKin,
  type KinListEntry,
  type KinRelation,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { AddRelativeForm } from "./add-relative-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function relationLabel(relation: KinRelation): string {
  return hub.kin.relationLabel[relation];
}

/**
 * The name to show for a kin row. An identified relative shows their own name. An unidentified
 * placeholder (an anonymous bridge node — `displayName === null` OR `identified === false`) is
 * rendered from its relation ("Unknown parent"), never a name.
 */
function displayNameFor(entry: KinListEntry): string {
  if (entry.identified && entry.displayName) return entry.displayName;
  return hub.kin.unknownOf(relationLabel(entry.relation));
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 30,
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {children}
      </p>
    </div>
  );
}

export default async function KinPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous gate — mirror the hub: a signed-out visitor is sent to the real front door.
  if (ctx.kind !== "account") {
    redirect("/");
  }

  const { scope: scopeParam } = await searchParams;

  const backLink = (
    <div style={{ marginBottom: 20 }}>
      <Link
        href="/hub"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          textDecoration: "none",
        }}
      >
        {"← "}
        {hub.shell.tabStories}
      </Link>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: "100dvh", background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px clamp(16px, 4vw, 32px)" }}>
        {backLink}
        {children}
      </div>
    </main>
  );

  // Resolve the current family: `?scope=` when it is one of the viewer's own active families, else
  // their first active family. A viewer in no family gets the no-family empty state.
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (activeFamilies.length === 0) {
    return shell(
      <>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 16px",
          }}
        >
          {hub.kin.heading}
        </h1>
        <EmptyCard>{hub.kin.noFamily}</EmptyCard>
      </>,
    );
  }

  const familyId =
    scopeParam && activeFamilies.some((f) => f.familyId === scopeParam)
      ? scopeParam
      : activeFamilies[0]!.familyId;

  const kin = await listMyKin(db, ctx, familyId);

  return shell(
    <>
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 8px",
        }}
      >
        {hub.kin.heading}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "8px 0 28px",
        }}
      >
        {hub.kin.intro}
      </p>

      {kin.length === 0 ? (
        <EmptyCard>{hub.kin.empty}</EmptyCard>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {kin.map((entry) => (
            <li
              key={entry.personId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "16px 20px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "var(--text-story)",
                  color: entry.identified && entry.displayName ? "var(--text-body)" : "var(--text-muted)",
                }}
              >
                {displayNameFor(entry)}
                {entry.lifeStatus === "deceased" ? (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui-sm)",
                      color: "var(--text-meta)",
                      marginLeft: 10,
                    }}
                  >
                    · {hub.kin.deceased}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {relationLabel(entry.relation)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section style={{ marginTop: 40 }}>
        <h2
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 8px",
          }}
        >
          {hub.kin.addHeading}
        </h2>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            lineHeight: "var(--leading-body)",
            color: "var(--text-muted)",
            margin: "8px 0 24px",
          }}
        >
          {hub.kin.addIntro}
        </p>
        <AddRelativeForm familyId={familyId} />
      </section>
    </>,
  );
}
