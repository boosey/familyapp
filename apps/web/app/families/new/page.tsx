/**
 * /families/new — steward create flow (ask #1). The creator becomes the family steward (core's
 * createFamily inserts the steward membership atomically). The "let relatives find this family"
 * toggle maps to families.discoverable, which gates whether the family surfaces in /families/find.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { createFamily } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function create(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const discoverable = formData.get("discoverable") === "on";
  if (!name) redirect("/families/new?error=name");

  await createFamily(db, {
    name,
    description: description || undefined,
    discoverable,
    creatorPersonId: ctx.personId,
  });
  redirect("/hub");
}

export default async function FamiliesNewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
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
          href="/families/start"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            fontWeight: 600,
            color: "var(--text-meta)",
          }}
        >
          ‹ Back
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
          Name your family
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
          This is the space your stories live in. You can change the details later.
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
            Please give your family a name.
          </p>
        ) : null}

        <form action={create} style={{ display: "grid", gap: 20 }}>
          <label className="kin-form-label">
            Family name
            <input
              name="name"
              type="text"
              required
              className="kin-field"
              placeholder="Boudreaux"
            />
          </label>
          <label className="kin-form-label">
            Description <span style={{ fontWeight: 400 }}>(optional)</span>
            <textarea
              name="description"
              className="kin-field"
              placeholder="The Boudreaux family of Lafayette, Louisiana."
              style={{ minHeight: 96 }}
            />
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-body)",
              cursor: "pointer",
            }}
          >
            <input
              name="discoverable"
              type="checkbox"
              style={{ width: 22, height: 22, marginTop: 2, accentColor: "var(--accent)" }}
            />
            <span>
              Let other relatives find this family
              <span
                style={{
                  display: "block",
                  fontSize: "var(--text-label)",
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                They can search for it and ask to join. You approve every request.
              </span>
            </span>
          </label>
          <KindredButton type="submit" label="Create family" fullWidth size="large" />
        </form>
      </div>
    </main>
  );
}
