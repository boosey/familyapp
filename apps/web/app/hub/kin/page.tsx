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
  listGovernableKinEdges,
  listMyKin,
  type AddRelativeRelation,
  type GovernableKinEdge,
  type KinListEntry,
  type KinRelation,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { AddRelativeForm } from "./add-relative-form";
import { KinEdgeControls } from "./kin-edge-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function relationLabel(relation: KinRelation): string {
  return hub.kin.relationLabel[relation];
}

/** The five relations the add-relative form offers (mirrors core's AddRelativeRelation). */
const VALID_RELATIONS: ReadonlySet<AddRelativeRelation> = new Set<AddRelativeRelation>([
  "parent",
  "child",
  "partner",
  "grandparent",
  "sibling",
]);

/** A `?relation=` param is honored only if it is one of the five allowed values; else ignored. */
function parsePresetRelation(value: string | undefined): AddRelativeRelation | undefined {
  return value && VALID_RELATIONS.has(value as AddRelativeRelation)
    ? (value as AddRelativeRelation)
    : undefined;
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

/** A person's name for an edge sentence — an unidentified bridge placeholder reads "someone unnamed". */
function endpointName(displayName: string | null, identified: boolean): string {
  return identified && displayName ? displayName : hub.kin.edgeUnknownPerson;
}

/**
 * The anchor's partners, derived from every visible `partnered_with` edge touching the anchor: the
 * OTHER endpoint on each such edge. Powers the co-parent picker on the add-child form (the reported
 * bug: adding a child to John only linked the child to John, not his partner Kelly) — a plain member
 * can offer their partner as a second parent without any new authority (the write path re-validates).
 */
function derivePartnersOf(
  edges: GovernableKinEdge[],
  anchorPersonId: string,
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const e of edges) {
    if (e.edgeType !== "partnered_with") continue;
    let otherId: string | null = null;
    let otherName: string | null = null;
    let otherIdentified = false;
    if (e.personAId === anchorPersonId) {
      otherId = e.personBId;
      otherName = e.personBDisplayName;
      otherIdentified = e.personBIdentified;
    } else if (e.personBId === anchorPersonId) {
      otherId = e.personAId;
      otherName = e.personADisplayName;
      otherIdentified = e.personAIdentified;
    }
    if (otherId !== null) {
      out.push({ id: otherId, name: endpointName(otherName, otherIdentified) });
    }
  }
  return out;
}

/** An ungendered sentence for one visible edge (parent_of / partnered_with), with an optional nature. */
function edgeSentence(edge: GovernableKinEdge): string {
  const a = endpointName(edge.personADisplayName, edge.personAIdentified);
  const b = endpointName(edge.personBDisplayName, edge.personBIdentified);
  if (edge.edgeType === "parent_of") {
    const nature = edge.nature ? hub.kin.natureLabel[edge.nature] : "";
    const base = hub.kin.edgeParentOf(a, b);
    return nature ? `${base} (${nature})` : base;
  }
  return hub.kin.edgePartneredWith(a, b);
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
  searchParams: Promise<{ scope?: string; anchor?: string; relation?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous gate — mirror the hub: a signed-out visitor is sent to the real front door.
  if (ctx.kind !== "account") {
    redirect("/");
  }

  const { scope: scopeParam, anchor: anchorParam, relation: relationParam } = await searchParams;
  // A targeted add carries the anchor person + intended relation (Task 7); both are re-validated
  // server-side (core checks the anchor's family membership; relation must be one of the five).
  const anchorPersonId = anchorParam && anchorParam.trim() ? anchorParam.trim() : undefined;
  const initialRelation = parsePresetRelation(relationParam);

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
  const edges = await listGovernableKinEdges(db, ctx, familyId);
  // The governance section is only meaningful if the viewer can act on at least one edge (steward, or
  // a self-endpoint who could hide). Otherwise it stays hidden — a plain member sees just their kin.
  const showGovernance = edges.some((e) => e.viewerIsSteward || e.viewerCanHide);

  // The co-parent picker's candidates: partners of the effective anchor (the explicit anchor, else
  // the viewer — mirrors core's own anchor default in addRelative).
  const effectiveAnchorId = anchorPersonId ?? ctx.personId;
  const coParentOptions = derivePartnersOf(edges, effectiveAnchorId);

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

      <div style={{ margin: "0 0 28px" }}>
        <Link
          href={`/hub/tree?scope=${familyId}`}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            fontWeight: 500,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          {hub.tree.openTree} {"→"}
        </Link>
      </div>

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

      {showGovernance ? (
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
            {hub.kin.govHeading}
          </h2>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              lineHeight: "var(--leading-body)",
              color: "var(--text-muted)",
              margin: "8px 0 20px",
            }}
          >
            {hub.kin.govIntro}
          </p>
          {edges.length === 0 ? (
            <EmptyCard>{hub.kin.govEmpty}</EmptyCard>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {edges.map((edge) => (
                <li
                  key={`${edge.edgeType}:${edge.personAId}:${edge.personBId}`}
                  style={{
                    background: "var(--surface-card)",
                    border: "var(--border-width) solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    padding: "16px 20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-story)",
                        fontSize: "var(--text-story)",
                        color: "var(--text-body)",
                      }}
                    >
                      {edgeSentence(edge)}
                    </span>
                    {edge.state === "affirmed" ? (
                      <span
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: "var(--text-ui-sm)",
                          fontWeight: 500,
                          color: "var(--text-muted)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {hub.kin.stateAffirmed}
                      </span>
                    ) : null}
                  </div>
                  <KinEdgeControls familyId={familyId} edge={edge} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
        <AddRelativeForm
          familyId={familyId}
          {...(anchorPersonId ? { anchorPersonId } : {})}
          {...(initialRelation ? { initialRelation } : {})}
          coParentOptions={coParentOptions}
        />
      </section>
    </>,
  );
}
