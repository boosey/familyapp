/**
 * Visual family tree (ADR-0016/0017 renderer, ego-centric redesign spec 2026-07-13).
 *
 * Server component. Resolves the viewer, the CURRENT family from the hub's single `?scope=` param
 * (validated against the viewer's OWN active families, falling back to their first active family), and
 * the FOCUS person from `?anchor=` / `?root=` (the person you were switched from — spec §1/§1a), else
 * the viewer for a direct tab visit. It roots the audited core read `resolveKinshipTree` ON THE FOCUS
 * (so a deep-linked relative outside the viewer's own window still loads THEIR neighborhood), then hands
 * that neighborhood plus the focus id to the client `<TreeCanvas>`. Node `relationToRoot` is therefore
 * relation-to-FOCUS; the panel derives relation-to-VIEWER client-side from the loaded edges. This page
 * never queries `persons`/`kinship` directly. A genuinely absent/invalid focus param falls back to the
 * viewer's own self-root (the only fallback).
 *
 * There is NO empty-state page (spec §8): an isolated focus is just their card with three "+" — the
 * tree IS the empty state. The only bail-outs are the anonymous gate and the no-family case.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  listActiveFamiliesForPerson,
  resolveKinshipTree,
  AuthorizationError,
  type KinshipTreeData,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { TreeCanvas } from "./tree-canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export default async function TreePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; root?: string; anchor?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous gate — a signed-out visitor is sent to the real front door (matches /hub/kin).
  if (ctx.kind !== "account") {
    redirect("/");
  }

  const { scope: scopeParam, root: rootParam, anchor: anchorParam } = await searchParams;
  // The focus deep-link param is either `?anchor=` or `?root=` (spec §1).
  const focusParam = anchorParam ?? rootParam;

  const heading = (
    <h1
      style={{
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-story-lg)",
        fontWeight: 500,
        color: "var(--text-body)",
        margin: "0 0 16px",
      }}
    >
      {hub.tree.heading}
    </h1>
  );

  const shell = (children: React.ReactNode, backHref?: string) => (
    <main style={{ minHeight: "100dvh", background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px clamp(16px, 4vw, 32px)" }}>
        {backHref ? (
          <div style={{ marginBottom: 20 }}>
            <Link
              href={backHref}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
            >
              {hub.tree.backToKin}
            </Link>
          </div>
        ) : null}
        {children}
      </div>
    </main>
  );

  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (activeFamilies.length === 0) {
    return shell(
      <>
        {heading}
        <EmptyCard>{hub.tree.noFamily}</EmptyCard>
      </>,
    );
  }

  const familyId =
    scopeParam && activeFamilies.some((f) => f.familyId === scopeParam)
      ? scopeParam
      : activeFamilies[0]!.familyId;

  const backHref = `/hub/kin?scope=${familyId}`;

  // Load a focus-rooted neighborhood through the audited front door. The core ROOT GUARD returns an
  // empty projection for a root that is neither the viewer nor a visible endpoint of THIS family, so a
  // forged/foreign `?anchor=` never leaks and simply fails validation below.
  const loadTree = async (rootPersonId: string): Promise<KinshipTreeData | null> => {
    try {
      return await resolveKinshipTree(db, ctx, familyId, rootPersonId);
    } catch (err) {
      if (err instanceof AuthorizationError) throw err;
      return null;
    }
  };

  // Resolve the FOCUS + its tree. A present `?anchor=`/`?root=` is tried FIRST, rooted on that person;
  // it is honored only if it materialized as a real node in its own projection (i.e. a visible family
  // member). Otherwise — absent or invalid focus param — fall back to the viewer's own self-root.
  let focusPersonId = ctx.personId;
  let data: KinshipTreeData | null = null;
  if (focusParam && focusParam !== ctx.personId) {
    const requested = await loadTree(focusParam);
    if (requested && requested.nodes.some((n) => n.personId === focusParam)) {
      focusPersonId = focusParam;
      data = requested;
    }
  }
  if (!data) {
    focusPersonId = ctx.personId;
    data = await loadTree(ctx.personId);
  }

  if (!data) {
    return shell(
      <>
        {heading}
        <EmptyCard>{hub.tree.noFamily}</EmptyCard>
      </>,
      backHref,
    );
  }

  return shell(
    <>
      {heading}
      <TreeCanvas
        familyId={familyId}
        focusPersonId={focusPersonId}
        viewerPersonId={ctx.personId}
        initial={data}
      />
    </>,
    backHref,
  );
}
