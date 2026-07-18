/**
 * Tests for the durable-vs-synchronous invite-delivery dispatch decision
 * (lib/dispatch-invite-delivery.ts), mirroring dispatch-pipeline.test.ts's branch-selection style:
 * fake job queue + fake `deliver` closure, asserting each branch calls exactly the one it should
 * and never the other.
 *
 * Also covers the RECEIVING end of the same boundary (`makeInviteSendWorker`, issue #103): the
 * durable payload carries the invite token envelope-ENCRYPTED (`sealedToken`), so these tests pin
 * that (a) the raw token never reaches the enqueued payload and (b) the worker opens the sealed
 * token and builds the correct `/join/<raw-token>` link from it.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryChannel } from "@chronicle/notifications";
import type { EnqueuedJob, JobHandler, JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import {
  makeDispatchInviteDelivery,
  makeInviteSendWorker,
} from "../lib/dispatch-invite-delivery";
import { openInviteToken, sealInviteToken } from "../lib/invite-token-seal";

const KEY = Buffer.alloc(32, 7);

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
  it("UNCONFIGURED: calls the synchronous deliver closure with invitationId/channels/link", async () => {
    const delivered: Array<{ invitationId: string; channels: DeliveryChannel[]; link: string }> = [];
    const jobQueue = fakeJobQueue();
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: false,
      inngestJobQueue: jobQueue,
      // The synchronous branch never seals — the token stays in-request.
      sealToken: () => {
        throw new Error("sealToken must not be called on the synchronous branch");
      },
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({
      invitationId: "inv-1",
      token: "raw-token",
      channels: ["email"],
      link: "https://app.example.com/join/raw-token",
    });

    expect(delivered).toEqual([
      { invitationId: "inv-1", channels: ["email"], link: "https://app.example.com/join/raw-token" },
    ]);
    // Synchronous path never touches the queue.
    expect(jobQueue.enqueued).toHaveLength(0);
  });

  it("CONFIGURED: enqueues invite.send with the SEALED token and does NOT deliver synchronously", async () => {
    const jobQueue = fakeJobQueue();
    let deliverCalls = 0;
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: true,
      inngestJobQueue: jobQueue,
      sealToken: (token) => sealInviteToken(token, KEY),
      deliver: async () => {
        deliverCalls += 1;
      },
    });

    await dispatch({
      invitationId: "inv-2",
      token: "raw-token-2",
      channels: ["email", "sms"],
      link: "https://app.example.com/join/raw-token-2",
    });

    expect(jobQueue.enqueued).toHaveLength(1);
    const job = jobQueue.enqueued[0]!;
    expect(job.name).toBe("invite.send");
    const payload = job.payload as { invitationId: string; sealedToken: string; channels: DeliveryChannel[] };
    expect(payload.invitationId).toBe("inv-2");
    expect(payload.channels).toEqual(["email", "sms"]);
    // The whole point of #103: the raw token is nowhere in the persisted payload...
    expect(JSON.stringify(payload)).not.toContain("raw-token-2");
    // ...but the worker can recover it from the sealed blob.
    expect(openInviteToken(payload.sealedToken, KEY)).toBe("raw-token-2");
    // Durable path never calls the synchronous deliver closure.
    expect(deliverCalls).toBe(0);
  });

  it("CONFIGURED but no shared job queue supplied: falls back to the synchronous path (defensive)", async () => {
    const delivered: Array<{ invitationId: string; channels: DeliveryChannel[]; link: string }> = [];
    const dispatch = makeDispatchInviteDelivery({
      inngestConfigured: true,
      sealToken: (token) => sealInviteToken(token, KEY),
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({
      invitationId: "inv-3",
      token: "raw-token-3",
      channels: ["sms"],
      link: "https://app.example.com/join/raw-token-3",
    });

    expect(delivered).toEqual([
      { invitationId: "inv-3", channels: ["sms"], link: "https://app.example.com/join/raw-token-3" },
    ]);
  });
});

describe("makeInviteSendWorker — opens the sealed payload and builds the join link", () => {
  it("delivers the correct /join/<raw-token> link from a sealed payload", async () => {
    const delivered: Array<{ invitationId: string; channels: DeliveryChannel[]; link: string }> = [];
    const worker = makeInviteSendWorker({
      openToken: (sealed) => openInviteToken(sealed, KEY),
      resolveOrigin: () => "https://app.example.com",
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await worker({
      invitationId: "inv-9",
      sealedToken: sealInviteToken("raw-token-9", KEY),
      channels: ["email"],
    });

    expect(delivered).toEqual([
      {
        invitationId: "inv-9",
        channels: ["email"],
        link: "https://app.example.com/join/raw-token-9",
      },
    ]);
  });

  it("propagates an open failure (wrong key / tampered payload) instead of delivering a bad link", async () => {
    let deliverCalls = 0;
    const worker = makeInviteSendWorker({
      openToken: (sealed) => openInviteToken(sealed, Buffer.alloc(32, 9)),
      resolveOrigin: () => "https://app.example.com",
      deliver: async () => {
        deliverCalls += 1;
      },
    });

    await expect(
      worker({
        invitationId: "inv-10",
        sealedToken: sealInviteToken("raw-token-10", KEY),
        channels: ["sms"],
      }),
    ).rejects.toThrow();
    expect(deliverCalls).toBe(0);
  });
});
