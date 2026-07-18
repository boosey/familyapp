/**
 * The invite-delivery dispatch decision, factored out of `lib/runtime.ts` so it is a pure,
 * directly-testable unit (no `server-only`, no PGlite boot). `build()` in runtime.ts wires the
 * real dependencies into `makeDispatchInviteDelivery` and exposes the result as
 * `Runtime.dispatchInviteDelivery`. Mirrors `lib/dispatch-pipeline.ts`'s branch shape exactly.
 *
 * Two honest branches, mirroring the env-switch idiom used everywhere else in runtime.ts:
 *
 *   - Inngest CONFIGURED (prod durable path): ENQUEUE ONLY. We SEAL the raw token
 *     (`sealToken` — AES-256-GCM under the server-held `INVITE_TOKEN_ENC_KEY`, see
 *     `lib/invite-token-seal.ts`) and call `jobQueue.enqueue("invite.send",
 *     { invitationId, sealedToken, channels })`, then return immediately. Inngest persists
 *     event payloads durably, so the raw token must never ride in plaintext — a leak of the
 *     job store then yields only ciphertext ("leak ≠ working invite", issue #103). The
 *     registered `invite.send` worker (wired in runtime.ts onto the SAME Inngest jobQueue that
 *     carries the pipeline stages) opens the sealed token and rebuilds the link at delivery
 *     time — the `link` argument is therefore UNUSED on this branch (it exists only for the
 *     synchronous branch's shape).
 *
 *   - Inngest UNCONFIGURED (dev/CI synchronous path): call the provided `deliver` closure (which
 *     wraps `deliverInvite` with the runtime's db + composite notifier) in-request, best-effort.
 *     The token never crosses a persisted boundary here, so nothing is sealed and no key is
 *     needed. A delivery failure here must never block invite creation — the caller (the server
 *     action) wraps this call in try/catch.
 *
 * This module ALSO carries the RECEIVING end of the boundary (`makeInviteSendWorker`), so the
 * seal/open contract is pinned in one place: the worker opens `sealedToken`, rebuilds the join
 * link from the resolved public origin, and hands off to the same-shaped `deliver` closure.
 */
import type { DeliveryChannel } from "@chronicle/notifications";
import type { InviteJobPayload, JobQueue } from "@chronicle/pipeline";
import { plog } from "@chronicle/pipeline";

export interface DispatchInviteDeliveryArgs {
  invitationId: string;
  token: string;
  channels: DeliveryChannel[];
  link: string;
}

export type DispatchInviteDelivery = (args: DispatchInviteDeliveryArgs) => Promise<void>;

export interface DispatchInviteDeliveryDeps {
  /** When true, enqueue onto the shared durable Inngest jobQueue; else run the in-process path. */
  inngestConfigured: boolean;
  /**
   * The shared Inngest jobQueue carrying the registered `invite.send` worker. Present iff
   * `inngestConfigured` is true.
   */
  inngestJobQueue?: JobQueue;
  /**
   * Envelope-encrypts the raw invite token for the durable payload (issue #103). Called ONLY on
   * the enqueue branch — the synchronous path keeps the token in-request and never seals.
   */
  sealToken: (token: string) => string;
  /**
   * The dev/CI synchronous delivery closure — wraps `deliverInvite` with the runtime's db +
   * composite notifier. Called with the caller-supplied `link` directly (no token→link rebuild
   * needed on this branch, since we're not crossing a worker boundary).
   */
  deliver: (args: { invitationId: string; channels: DeliveryChannel[]; link: string }) => Promise<void>;
}

export function makeDispatchInviteDelivery(
  deps: DispatchInviteDeliveryDeps,
): DispatchInviteDelivery {
  return async (args: DispatchInviteDeliveryArgs): Promise<void> => {
    if (deps.inngestConfigured && deps.inngestJobQueue) {
      // Durable path: seal the token, enqueue only. The invite.send worker opens the sealed
      // token and rebuilds the link. (Random IV per seal ⇒ re-enqueues of the same invite
      // produce distinct ciphertext, so Inngest's payload-hash dedupe no longer collapses
      // them — delivery is idempotent per invitation, so an occasional duplicate is benign.)
      plog("invite", "dispatch: durable enqueue (Inngest worker delivers)", {
        invitationId: args.invitationId,
        channels: args.channels.join(","),
      });
      await deps.inngestJobQueue.enqueue("invite.send", {
        invitationId: args.invitationId,
        sealedToken: deps.sealToken(args.token),
        channels: args.channels,
      });
      return;
    }
    // Synchronous dev/CI path: deliver in-request, best-effort.
    plog("invite", "dispatch: synchronous delivery (in-request)", {
      invitationId: args.invitationId,
      channels: args.channels.join(","),
    });
    await deps.deliver({
      invitationId: args.invitationId,
      channels: args.channels,
      link: args.link,
    });
  };
}

export interface InviteSendWorkerDeps {
  /**
   * Opens the sealed token from the job payload (AES-256-GCM under `INVITE_TOKEN_ENC_KEY`).
   * Throws on tamper/wrong key — the error propagates so Inngest retries/fails the job rather
   * than delivering a bad link.
   */
  openToken: (sealedToken: string) => string;
  /**
   * Resolves the public origin. The worker runs with NO request context, so this reads
   * `APP_BASE_URL` (validated at boot by `assertInngestServeable`).
   */
  resolveOrigin: () => string;
  /** Delivery closure — wraps `deliverInvite` with the runtime's db + composite notifier. */
  deliver: (args: { invitationId: string; channels: DeliveryChannel[]; link: string }) => Promise<void>;
}

/**
 * The receiving end of the durable invite-delivery boundary (issue #103): open the sealed
 * token, rebuild the join link, deliver. Durable delivery never carries a caller-constructed
 * link across the enqueue boundary.
 */
export function makeInviteSendWorker(
  deps: InviteSendWorkerDeps,
): (payload: InviteJobPayload) => Promise<void> {
  return async (payload: InviteJobPayload): Promise<void> => {
    const token = deps.openToken(payload.sealedToken);
    const origin = deps.resolveOrigin();
    await deps.deliver({
      invitationId: payload.invitationId,
      channels: payload.channels,
      link: `${origin}/join/${token}`,
    });
  };
}
