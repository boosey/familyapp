/**
 * The invite-delivery dispatch decision, factored out of `lib/runtime.ts` so it is a pure,
 * directly-testable unit (no `server-only`, no PGlite boot). `build()` in runtime.ts wires the
 * real dependencies into `makeDispatchInviteDelivery` and exposes the result as
 * `Runtime.dispatchInviteDelivery`. Mirrors `lib/dispatch-pipeline.ts`'s branch shape exactly.
 *
 * Two honest branches, mirroring the env-switch idiom used everywhere else in runtime.ts:
 *
 *   - Inngest CONFIGURED (prod durable path): ENQUEUE ONLY. We call `jobQueue.enqueue("invite.send",
 *     { invitationId, channels })` and return immediately. The payload carries NO token — the raw
 *     invite token never crosses the enqueue boundary (it would sit in the persisted event
 *     payload). The registered `invite.send` worker (wired in runtime.ts onto the SAME Inngest
 *     jobQueue that carries the pipeline stages) recovers the token at delivery time via core's
 *     `getInvitationTokenForDelivery` and rebuilds the link from it.
 *
 *   - Inngest UNCONFIGURED (dev/CI synchronous path): call the provided `deliver` closure (which
 *     wraps `deliverInvite` with the runtime's db + composite notifier) in-request, best-effort.
 *     The closure recovers the token the same way the worker does — the caller never hands a raw
 *     token (or a link derived from one) to this seam. A delivery failure here must never block
 *     invite creation — the caller (the server action) wraps this call in try/catch.
 */
import type { DeliveryChannel } from "@chronicle/notifications";
import type { JobQueue } from "@chronicle/pipeline";
import { plog } from "@chronicle/pipeline";

export interface DispatchInviteDeliveryArgs {
  invitationId: string;
  channels: DeliveryChannel[];
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
   * The dev/CI synchronous delivery closure — wraps `deliverInvite` with the runtime's db +
   * composite notifier, recovering the token via `getInvitationTokenForDelivery` and building
   * the link itself (the caller supplies neither).
   */
  deliver: (args: { invitationId: string; channels: DeliveryChannel[] }) => Promise<void>;
}

export function makeDispatchInviteDelivery(
  deps: DispatchInviteDeliveryDeps,
): DispatchInviteDelivery {
  return async (args: DispatchInviteDeliveryArgs): Promise<void> => {
    if (deps.inngestConfigured && deps.inngestJobQueue) {
      // Durable path: enqueue only. The invite.send worker recovers the token and rebuilds the link.
      plog("invite", "dispatch: durable enqueue (Inngest worker delivers)", {
        invitationId: args.invitationId,
        channels: args.channels.join(","),
      });
      await deps.inngestJobQueue.enqueue("invite.send", {
        invitationId: args.invitationId,
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
    });
  };
}
