/**
 * Requests tab — the steward's side of ask #2. Lists PENDING join requests for the SELECTED family
 * (Decline / Approve while pending), plus recently-DECIDED requests rendered in place with a mono
 * APPROVED/DECLINED status so a row doesn't just vanish the moment it's decided. Approve creates the
 * requester's active membership (core handles it); Decline marks it declined. Both server actions
 * redirect back to this tab so the list refreshes.
 *
 * Server component. It fetches ALL of the viewer's steward requests (each already authorized), scopes
 * them to the single family selected via the shared `?families=` filter (#159 — the Requests surface
 * now shares the URL-driven family selector instead of a bespoke client "designator"), and renders:
 *   1. the progressive FamilySurfaceNav row (#297) with Tree/List/Requests + Family chips (badged
 *      per-family with pending counts) + Invite — chips live IN the control row, not a second toolbar;
 *   2. the "Requests to join" heading + an <InfoTooltip> (#160 — the steward instruction moved off an
 *      always-on paragraph into an on-demand tooltip);
 *   3. the presentational <RequestsList> of the scoped rows.
 */
import { redirect } from "next/navigation";
import {
  approveJoinRequest,
  declineJoinRequest,
  listDecidedJoinRequestsForSteward,
  listPendingJoinRequestsForSteward,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { pendingRequestChipBadges, requestsInScope } from "@/lib/hub-tabs";
import { FamilyChips } from "@/app/hub/FamilyChips";
import { FamilySurfaceNav } from "@/app/hub/FamilySurfaceNav";
import { InfoTooltip } from "@/app/hub/InfoTooltip";
import familyStyles from "./FamilyTab.module.css";
import { RequestsList, type RequestRow } from "./RequestsList";

async function approve(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const joinRequestId = String(formData.get("joinRequestId") ?? "");
  if (joinRequestId) {
    await approveJoinRequest(db, { joinRequestId, deciderPersonId: ctx.personId });
  }
  redirect("/hub?tab=requests");
}

async function decline(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const joinRequestId = String(formData.get("joinRequestId") ?? "");
  if (joinRequestId) {
    await declineJoinRequest(db, { joinRequestId, deciderPersonId: ctx.personId });
  }
  redirect("/hub?tab=requests");
}

export async function RequestsTab({
  families = [],
  scopeFamilyId = "all",
  surface,
}: {
  families?: { id: string; name: string; shortName?: string | null }[];
  /** The single resolved scope family id from the shared `?families=` filter, or "all" (show every
   *  stewarded family's requests — the fallback for a scopeless / non-member deep-link). */
  scopeFamilyId?: string;
  /**
   * Progressive control-row data for {@link FamilySurfaceNav} (#297). Requests owns the row (like
   * FamilyTab on tree/list) so Family chips fold into the same chrome instead of a second toolbar.
   */
  surface: {
    familiesParam: string | null;
    showRequests: boolean;
    requestsBadge?: number;
    inviteHref?: string;
  };
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
        }}
      >
        {hub.requests.signedOut}
      </p>
    );
  }

  const [allPending, allDecided] = await Promise.all([
    listPendingJoinRequestsForSteward(db, ctx.personId),
    listDecidedJoinRequestsForSteward(db, ctx.personId),
  ]);

  // Pending rows have no status field (they're pending by definition) — supply it so the row shape is
  // uniform; only decided rows render a status badge.
  const pending: RequestRow[] = allPending.map((r) => ({
    joinRequestId: r.joinRequestId,
    familyId: r.familyId,
    familyName: r.familyName,
    requesterName: r.requesterName,
    message: r.message,
    status: "pending",
  }));
  const decided: RequestRow[] = allDecided.map((r) => ({
    joinRequestId: r.joinRequestId,
    familyId: r.familyId,
    familyName: r.familyName,
    requesterName: r.requesterName,
    message: r.message,
    status: r.status,
  }));

  // #140 per-family pending-request counts from the FULL pending set (independent of the selected
  // family), so every chip carries its own count; they sum to the aggregate Requests badge upstream.
  // Precompute serializable badge label STRINGS — a formatter fn can't cross the RSC boundary.
  const { badges: pendingCountByFamily, badgeLabels: pendingCountLabels } = pendingRequestChipBadges(
    pending,
    hub.requests.pendingCountAria,
  );

  // Scope the already-authorized rows to the selected family via the shared pure helper (the SAME the
  // browse filter uses), so the URL filter and the rendered list stay in lockstep.
  const visiblePending = requestsInScope(pending, scopeFamilyId);
  const visibleDecided = requestsInScope(decided, scopeFamilyId);

  // Progressive Family unit: gate on ≥2 families so a truthy empty chip element never mounts a Family
  // icon. Badged per-family with pending counts (#140).
  const familyChips =
    families.length >= 2 ? (
      <FamilyChips
        singleSelect
        inline
        families={families}
        selected={[scopeFamilyId]}
        badges={pendingCountByFamily}
        badgeLabels={pendingCountLabels}
        rowClassName={familyStyles.familyChipsScroll}
      />
    ) : null;

  return (
    <div>
      {/* Progressive control row (#297): Sub tabs + Family chips + Invite — one row, not a second toolbar. */}
      <FamilySurfaceNav
        active="requests"
        familiesParam={surface.familiesParam}
        showRequests={surface.showRequests}
        requestsBadge={surface.requestsBadge}
        inviteHref={surface.inviteHref}
        row2Left={familyChips}
      />

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
        {/* #160: the steward instruction is revealed on demand by this info icon instead of a
            standing paragraph. */}
        <InfoTooltip label={hub.requests.infoAria} text={hub.requests.intro} />
      </h2>

      <RequestsList
        pending={visiblePending}
        decided={visibleDecided}
        approve={approve}
        decline={decline}
      />
    </div>
  );
}
