/**
 * Requests tab — the steward's side of ask #2. Lists PENDING join requests across every family this
 * Person stewards (Decline / Approve while pending), plus recently-DECIDED requests rendered in
 * place with a mono APPROVED/DECLINED status so a row doesn't just vanish the moment it's decided.
 * Approve creates the requester's active membership (core handles it); Decline marks it declined.
 * Both server actions redirect back to this tab so the list refreshes.
 *
 * Server component: fetches ALL of the viewer's steward requests (each already authorized) and hands
 * them — plus the viewer's families, a SEED family id from the current `?families=` filter, and the
 * two Server Actions — to <RequestsDesignator> (a client component holding the designated family in
 * local state and filtering client-side; ADR-0021 DESIGNATOR mode, no URL write).
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
import { RequestsDesignator, type RequestRow } from "./RequestsDesignator";

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
  seedFamilyId = "all",
}: {
  families?: { id: string; name: string; shortName?: string | null }[];
  seedFamilyId?: string;
} = {}) {
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

  // Pending rows have no status field (they're pending by definition) — supply it so the client row
  // shape is uniform; the client only renders a status badge on decided rows.
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

  return (
    <RequestsDesignator
      families={families}
      seedFamilyId={seedFamilyId}
      pending={pending}
      decided={decided}
      approve={approve}
      decline={decline}
    />
  );
}
