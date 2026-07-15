/**
 * /families/[id]/edit — steward-only Edit-a-Family surface (ADR-0021 Edit-a-Family, #54). Only the
 * family's steward may open or submit this screen: the page guards on load (a missing family AND a
 * non-steward both → notFound(), so a non-member can't probe which family UUIDs exist — no existence
 * oracle, matching the /hub/person/[personId] `canViewerSeePerson` precedent), and the server action
 * (`updateFamilyAction`) re-checks stewardship via core's updateFamily (defence in depth against a
 * tampered hidden familyId — AuthorizationError/InvariantViolation → /hub).
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { getFamily } from "@chronicle/core";
import { families } from "@/app/_copy";
import { EditFamilyForm } from "./EditFamilyForm";
import { updateFamilyAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FamilyEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  // Guard a malformed id BEFORE querying: `families.id` is a uuid column, so a non-UUID value would
  // raise a DB parse error (500). Treat it as "no such family" → the same notFound() a real non-member
  // gets, so the page stays no existence oracle (matches the tell/[storyId] precedent).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const family = await getFamily(db, id);
  // A missing family AND a non-steward both return notFound() — a signed-in non-member gets the same
  // 404 whether the id is nonexistent or simply not theirs, so the page is no existence oracle (matches
  // the /hub/person/[personId] `canViewerSeePerson` precedent).
  if (!family || family.stewardPersonId !== ctx.personId) notFound();

  const { error } = await searchParams;

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
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          padding: "clamp(28px, 5vw, 48px)",
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        <Link
          href="/hub"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            fontWeight: 600,
            color: "var(--text-meta)",
          }}
        >
          ‹ {families.edit.back}
        </Link>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-display)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "14px 0 8px",
            lineHeight: "var(--leading-tight)",
          }}
        >
          {families.edit.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 24px",
            lineHeight: "var(--leading-body)",
          }}
        >
          {families.edit.intro}
        </p>

        {error === "name" ? (
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
            {families.edit.errorNoName}
          </p>
        ) : null}

        <EditFamilyForm
          action={updateFamilyAction}
          familyId={id}
          initialName={family.name}
          initialShortName={family.shortName ?? ""}
          initialDescription={family.description ?? ""}
          initialDiscoverable={family.discoverable}
        />
      </div>
    </main>
  );
}
