"use client";

/**
 * RequestsDesignator — the client half of the Requests tab (ADR-0021, DESIGNATOR mode).
 *
 * The server (RequestsTab) fetches ALL pending + decided join requests across every family the viewer
 * stewards (each already authorized), plus the viewer's families and a SEED family id derived from the
 * current `?families=` filter. This component holds the designated family in local state (seeded once),
 * renders the shared FamilyChips in single-select designator mode (only when ≥2 families), and FILTERS
 * the already-authorized rows to the designated family CLIENT-SIDE. It never refetches and never writes
 * the URL. The approve/decline Server Actions are passed in from the server component and used directly
 * as `<form action={…}>` — Server Actions are valid props to a client component in Next 15.
 */
import { useState } from "react";
import { KindredButton } from "@/app/_kindred";
import { FamilyChips } from "@/app/hub/FamilyChips";
import { requestsInScope } from "@/lib/hub-tabs";
import { hub } from "@/app/_copy";

export interface RequestRow {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  requesterName: string;
  message: string | null;
  status: string;
}

interface RequestsDesignatorProps {
  families: { id: string; name: string }[];
  /** Seed from the current `?families=` filter: a family id, or "all" (no single family selected). */
  seedFamilyId: string;
  pending: RequestRow[];
  decided: RequestRow[];
  approve: (formData: FormData) => Promise<void>;
  decline: (formData: FormData) => Promise<void>;
}

/** Resolve the initial designated family: the seed if it names a real family, else the first family. */
function resolveSeed(families: { id: string }[], seedFamilyId: string): string {
  if (families.some((f) => f.id === seedFamilyId)) return seedFamilyId;
  return families[0]?.id ?? "";
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 20,
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-card)",
  padding: "20px 24px",
} as const;

const familyLabelStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "var(--tracking-mono)",
  color: "var(--support)",
  marginBottom: 4,
} as const;

const nameStyle = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story)",
  color: "var(--text-body)",
} as const;

/** First letter of the requester's name, for the avatar circle. */
function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--accent-soft)",
        color: "var(--accent-strong)",
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-story)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {initialOf(name)}
    </span>
  );
}

export function RequestsDesignator({
  families,
  seedFamilyId,
  pending,
  decided,
  approve,
  decline,
}: RequestsDesignatorProps) {
  const [selected, setSelected] = useState(() => resolveSeed(families, seedFamilyId));

  // <2 families → no chip bar; show every family's requests ("all"). ≥2 families → narrow to the
  // designated family's rows client-side (no URL write) via the shared `requestsInScope` filter — the
  // same pure helper the server tab used, so the browse-filter and designator paths stay in lockstep.
  // For a designator the scope is always a concrete family id (never "all"); when there's no chip bar
  // we pass "all" to show every request.
  const showChips = families.length >= 2;
  const scope = showChips ? selected : "all";
  const visiblePending = requestsInScope(pending, scope);
  const visibleDecided = requestsInScope(decided, scope);

  const heading = (
    <>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.requests.title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 0",
        }}
      >
        {hub.requests.intro}
      </p>
    </>
  );

  const chips = showChips ? (
    <div style={{ margin: "20px 0 0" }}>
      <FamilyChips families={families} value={selected} onSelect={setSelected} />
    </div>
  ) : null;

  if (visiblePending.length === 0 && visibleDecided.length === 0) {
    return (
      <div>
        {heading}
        {chips}
        <div
          style={{
            marginTop: 24,
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
            {hub.requests.empty}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {chips}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "24px 0 0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {visiblePending.map((r) => (
          <li key={r.joinRequestId} style={rowStyle}>
            <Avatar name={r.requesterName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={familyLabelStyle}>{r.familyName.toUpperCase()}</div>
              <div style={nameStyle}>{r.requesterName}</div>
              {r.message ? (
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    color: "var(--text-meta)",
                    lineHeight: "var(--leading-body)",
                    margin: "8px 0 0",
                  }}
                >
                  “{r.message}”
                </p>
              ) : null}
            </div>
            {/* Decline (ghost) before Approve (primary), per design. */}
            <div style={{ display: "flex", gap: 10, flex: "0 0 auto" }}>
              <form action={decline}>
                <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
                <KindredButton
                  type="submit"
                  label={hub.requests.decline}
                  variant="ghost"
                  size="small"
                />
              </form>
              <form action={approve}>
                <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
                <KindredButton type="submit" label={hub.requests.approve} size="small" />
              </form>
            </div>
          </li>
        ))}

        {visibleDecided.map((r) => {
          const approved = r.status === "approved";
          return (
            <li key={r.joinRequestId} style={rowStyle}>
              <Avatar name={r.requesterName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={familyLabelStyle}>{r.familyName.toUpperCase()}</div>
                <div style={nameStyle}>{r.requesterName}</div>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  letterSpacing: "var(--tracking-mono)",
                  textTransform: "uppercase",
                  color: approved ? "var(--accent-strong)" : "var(--support)",
                  flex: "0 0 auto",
                }}
              >
                {(approved ? hub.requests.statusApproved : hub.requests.statusDeclined).toUpperCase()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
