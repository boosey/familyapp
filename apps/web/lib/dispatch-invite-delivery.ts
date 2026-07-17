/**
 * The invite-delivery dispatch decision, factored out of `lib/runtime.ts` so it is a pure,
 * directly-testable unit (no `server-only`, no PGlite boot). `build()` in runtime.ts wires the
 * real dependencies into `makeDispatchInviteDelivery` and exposes the result as
 * `Runtime.dispatchInviteDelivery`. Mirrors `lib/dispatch-pipeline.ts`'s branch shape exactly.
 *
 * Two honest branches, mirroring the env-switch idiom used everywhere else in runtime.ts:
 *
 *   - Inngest CONFIGURED (prod durable path): ENQUEUE ONLY. We call `jobQueue.enqueue("invite.send",
 *     { invitationId, token, channels })` and return immediately. The registered `invite.send`
 *     worker (wired in runtime.ts onto the SAME Inngest jobQueue that carries the pipeline stages)
 *     rebuilds the link from the token at delivery time — the `link` argument is therefore UNUSED
 *     on this branch (it exists only for the synchronous branch's shape).
 *
 *   - Inngest UNCONFIGURED (dev/CI synchronous path): call the provided `deliver` closure (which
 *     wraps `deliverInvite` with the runtime's db + composite notifier) in-request, best-effort.
 *     A delivery failure here must never block invite creation — the caller (the server action)
 *     wraps this call in try/catch.
 */
import type { DeliveryChannel } from "@chronicle/notifications";
import type { JobQueue } from "@chronicle/pipeline";
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
      // Durable path: enqueue only. The invite.send worker rebuilds the link from the token.
      plog("invite", "dispatch: durable enqueue (Inngest worker delivers)", {
        invitationId: args.invitationId,
        channels: args.channels.join(","),
      });
      await deps.inngestJobQueue.enqueue("invite.send", {
        invitationId: args.invitationId,
        token: args.token,
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
