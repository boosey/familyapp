/**
 * Tests for the durable-vs-synchronous invite-delivery dispatch decision
 * (lib/dispatch-invite-delivery.ts), mirroring dispatch-pipeline.test.ts's branch-selection style:
 * fake job queue + fake `deliver` closure, asserting each branch calls exactly the one it should
 * and never the other. Neither branch carries the raw invite token — the worker and the sync
 * closure both recover it server-side via `getInvitationTokenForDelivery`.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryChannel } from "@chronicle/notifications";
import type { EnqueuedJob, JobHandler, JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import { makeDispatchInviteDelivery } from "../lib/dispatch-invite-delivery";

/** A JobQueue test double that records enqueue calls; register/drain/pending are unused stubs. */
function fakeJobQueue(): JobQueue & { enqueued: Array<{ name: JobName; payload: unknown }> } {
  const enqueued: Array<{ name: JobName; payload: unknown }> = [];
  return {
    enqueued,
    async enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string> {
      enqueued.push({ name, payload });
      return "job-id";
    },
    register<N extends JobName>(_name: N, _handler: JobHandler<N>): void {
      // no-op stub
    },
    async drain(): Promise<void> {},
    pending(): EnqueuedJob[] {
      return [];
    },
  };
}

describe("makeDispatchInviteDelivery — branch selection", () => {
  it("UNCONFIGURED: calls the synchronous deliver closure with invitationId/channels only", async () => {
    const delivered: Array<{ invitationId: string; channels: DeliveryChannel[] }> = [];
    const jobQueue = fakeJobQueue();
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: false,
      inngestJobQueue: jobQueue,
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({
      invitationId: "inv-1",
      channels: ["email"],
    });

    expect(delivered).toEqual([{ invitationId: "inv-1", channels: ["email"] }]);
    // Synchronous path never touches the queue.
    expect(jobQueue.enqueued).toHaveLength(0);
  });

  it("CONFIGURED: enqueues invite.send with invitationId/channels (NO token) and does NOT deliver synchronously", async () => {
    const jobQueue = fakeJobQueue();
    let deliverCalls = 0;
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: true,
      inngestJobQueue: jobQueue,
      deliver: async () => {
        deliverCalls += 1;
      },
    });

    await dispatch({
      invitationId: "inv-2",
      channels: ["email", "sms"],
    });

    expect(jobQueue.enqueued).toEqual([
      {
        name: "invite.send",
        // The raw token must NOT appear in the event payload — the worker recovers it from the DB.
        payload: { invitationId: "inv-2", channels: ["email", "sms"] },
      },
    ]);
    // Durable path never calls the synchronous deliver closure.
    expect(deliverCalls).toBe(0);
  });

  it("CONFIGURED but no shared job queue supplied: falls back to the synchronous path (defensive)", async () => {
    const delivered: Array<{ invitationId: string; channels: DeliveryChannel[] }> = [];
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: true,
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({
      invitationId: "inv-3",
      channels: ["sms"],
    });

    expect(delivered).toEqual([{ invitationId: "inv-3", channels: ["sms"] }]);
  });
});
