/**
 * RequestsList — the presentational list of steward join-requests (pending rows with Decline/Approve,
 * plus recently-decided rows shown in place with a mono APPROVED/DECLINED status so a row doesn't
 * vanish the instant it's decided).
 *
 * Pure presentation: the rows are already fetched, already authorized, and already SCOPED to the
 * selected family by the server (RequestsTab) via `?families=` (#159 — the Requests surface now shares
 * the URL-driven family selector, so this component holds no state and no chip bar). The approve/decline
 * Server Actions are passed straight through to `<form action={…}>`.
 */
import { ActionButton } from "@/app/_kindred/ActionButton";
import { hub } from "@/app/_copy";
import styles from "./RequestsList.module.css";

export interface RequestRow {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  requesterName: string;
  message: string | null;
  status: string;
  /** #352: this (approved) row was auto-approved off a matching invitation — label it distinctly. */
  viaInvitation?: boolean;
}

interface RequestsListProps {
  pending: RequestRow[];
  decided: RequestRow[];
  approve: (formData: FormData) => Promise<void>;
  decline: (formData: FormData) => Promise<void>;
}

/** First letter of the requester's name, for the avatar circle. */
function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className={styles.avatar}>
      {initialOf(name)}
    </span>
  );
}

export function RequestsList({ pending, decided, approve, decline }: RequestsListProps) {
  if (pending.length === 0 && decided.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>{hub.requests.empty}</p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {pending.map((r) => (
        <li key={r.joinRequestId} className={styles.row}>
          <Avatar name={r.requesterName} />
          <div className={styles.content}>
            <div className={styles.familyLabel}>{r.familyName.toUpperCase()}</div>
            <div className={styles.name}>{r.requesterName}</div>
            {r.message ? <p className={styles.message}>“{r.message}”</p> : null}
          </div>
          {/* Decline (ghost) before Approve (primary), per design. */}
          <div className={styles.actions}>
            <form action={decline}>
              <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
              <ActionButton
                type="submit"
                label={hub.requests.decline}
                variant="ghost"
              />
            </form>
            <form action={approve}>
              <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
              <ActionButton type="submit" label={hub.requests.approve} />
            </form>
          </div>
        </li>
      ))}

      {decided.map((r) => {
        const approved = r.status === "approved";
        return (
          <li key={r.joinRequestId} className={styles.row}>
            <Avatar name={r.requesterName} />
            <div className={styles.content}>
              <div className={styles.familyLabel}>{r.familyName.toUpperCase()}</div>
              <div className={styles.name}>{r.requesterName}</div>
            </div>
            <span className={styles.status} data-approved={approved ? "true" : "false"}>
              {(approved
                ? r.viaInvitation
                  ? hub.requests.statusApprovedByInvitation
                  : hub.requests.statusApproved
                : hub.requests.statusDeclined
              ).toUpperCase()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
