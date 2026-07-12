/**
 * Visual family tree (ADR-0016 tree renderer, spec §3/§9) — read-first, per-family, You-anchored.
 *
 * Server component. Resolves the viewer, the CURRENT family from the hub's single `?scope=` param
 * (validated against the viewer's OWN active families, falling back to their first active family — the
 * same rule /hub/kin uses), and the anchor root from `?root=` (validated to be a node in the family
 * projection, else defaulting to the viewer's own person). It then calls the audited core read
 * `resolveKinshipTree` and hands the bounded neighborhood to the client `<TreeCanvas>`. This page never
 * queries `persons`/`kinship` directly — the core read hydrates everything behind the kinship front
 * door, and rejects anonymous viewers upstream (we also gate here, defense in depth).
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
  searchParams: Promise<{ scope?: string; root?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous gate — a signed-out visitor is sent to the real front door (matches /hub/kin).
  if (ctx.kind !== "account") {
    redirect("/");
  }

  const { scope: scopeParam, root: rootParam } = await searchParams;

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

  // Resolve the current family: `?scope=` when it is one of the viewer's own active families, else
  // their first active family. A viewer in no family gets the no-family empty state.
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

  // Resolve the root. Try the requested `?root=` first; validate it is a node in the projection, else
  // fall back to the viewer's own person. Both reads go through the audited core front door.
  const loadTree = async (rootPersonId: string): Promise<KinshipTreeData | null> => {
    try {
      return await resolveKinshipTree(db, ctx, familyId, rootPersonId);
    } catch (err) {
      if (err instanceof AuthorizationError) throw err;
      return null;
    }
  };

  let data: KinshipTreeData | null = null;
  if (rootParam && rootParam !== ctx.personId) {
    const requested = await loadTree(rootParam);
    // Valid only when the requested root actually materialized as a node in its own projection.
    if (requested && requested.nodes.some((n) => n.personId === rootParam)) {
      data = requested;
    }
  }
  if (!data) {
    // Default (or invalid-root fallback): the viewer's own person.
    data = await loadTree(ctx.personId);
  }

  if (!data) {
    // Should be unreachable for a valid member, but keep a graceful floor.
    return shell(
      <>
        {heading}
        <EmptyCard>{hub.tree.noFamily}</EmptyCard>
      </>,
      backHref,
    );
  }

  // Root-only / no kin: just the viewer's own node, nothing to draw beyond it.
  const rootHasKin = data.nodes.length > 1;
  if (!rootHasKin) {
    return shell(
      <>
        {heading}
        <EmptyCard>
          {hub.tree.emptyRootOnly}
          <br />
          <Link
            href="/hub/kin"
            style={{
              display: "inline-block",
              marginTop: 12,
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              fontWeight: 500,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            {hub.tree.addRelativeCta} {"→"}
          </Link>
        </EmptyCard>
      </>,
      backHref,
    );
  }

  return shell(
    <>
      {heading}
      {/*
        Key by root identity so "Center tree here" — a SOFT next/link navigation to the same route
        segment (`?root=`) — forces a fresh <TreeCanvas> mount. Without the key React would reuse the
        existing instance, and TreeCanvas's `useState(initial.nodes)` (initializer-only) would keep the
        PREVIOUS root's node/edge set, rendering blank against a root absent from the stale data.
      */}
      <TreeCanvas
        key={data.rootPersonId}
        familyId={familyId}
        rootPersonId={data.rootPersonId}
        initial={data}
      />
    </>,
    backHref,
  );
}
