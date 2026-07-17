# Invite Delivery (Email + SMS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically deliver a member-invitation link to the invitee by email (Resend) and/or SMS (Twilio), async via Inngest, while keeping the copy-link card as a fallback.

**Architecture:** A new vendor-seam package `@chronicle/notifications` (interface + mock in-package; Resend/Twilio SDKs only in adapter files). The existing story-typed `JobQueue` seam is generalized to a generic per-job-name payload map so it can also carry an `invite.send` job without touching pipeline handlers. A pure `deliverInvite` orchestrator (PGlite + MockNotifier tested) is wrapped by an Inngest function in prod; the `createMemberInvite` server action enqueues after `createInvitation` commits. New nullable columns on `invitations` record delivery outcome.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`), pnpm workspaces, Drizzle + PGlite, Vitest, Inngest, Resend, Twilio, libphonenumber-js, Next.js 15 server actions.

**Spec:** `docs/superpowers/specs/2026-07-17-invite-delivery-email-sms-design.md`

**Global rules for every task:** TDD (red → green). Commit at the end of each task. Do NOT push or open a PR — the main agent runs the preflight and handles the PR. Do NOT merge to master. Run only the targeted package's tests in your red-green loop; the main agent runs the full preflight at the end.

---

## Shared contracts (Tasks 1–3) come first — blocking

Per the repo's "shared contracts first" rule, Tasks 1, 2, and 3 fix the interfaces the rest depend on (the `Notifier` types, the generalized `JobQueue` types + invite payload, and the DB columns + `CreateInvitationInput` shape). They must land before the parallel adapter/util/UI work.

---

### Task 1: Scaffold `@chronicle/notifications` + `Notifier` contract + `MockNotifier`

**Files:**
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json` (copy from `packages/storage/tsconfig.json`)
- Create: `packages/notifications/src/index.ts`
- Create: `packages/notifications/src/contracts.ts`
- Create: `packages/notifications/src/mock.ts`
- Test: `packages/notifications/test/mock.test.ts`

- [ ] **Step 1: `package.json`** (mirror `@chronicle/storage`, no vendor deps yet):

```json
{
  "name": "@chronicle/notifications",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {},
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: `contracts.ts`** — the seam:

```ts
export type DeliveryChannel = "email" | "sms";

export type NotificationMessage =
  | { channel: "email"; to: string; subject: string; text: string; html?: string }
  | { channel: "sms"; to: string; text: string };

export type DeliveryResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string };

/** One external delivery vendor behind a vendor-neutral interface (Resend, Twilio). */
export interface Notifier {
  send(msg: NotificationMessage): Promise<DeliveryResult>;
}
```

- [ ] **Step 3: Write failing test** `test/mock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MockNotifier } from "../src/mock";

describe("MockNotifier", () => {
  it("records each send and returns ok by default", async () => {
    const n = new MockNotifier();
    const r = await n.send({ channel: "email", to: "a@b.com", subject: "Hi", text: "link" });
    expect(r).toEqual({ ok: true, providerId: expect.any(String) });
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]).toMatchObject({ channel: "email", to: "a@b.com" });
  });

  it("fails a scripted channel", async () => {
    const n = new MockNotifier({ failChannels: ["sms"] });
    const r = await n.send({ channel: "sms", to: "+15551230000", text: "link" });
    expect(r).toEqual({ ok: false, error: expect.any(String) });
  });
});
```

- [ ] **Step 4: Run — expect FAIL** (`MockNotifier` not defined):
  `pnpm --filter @chronicle/notifications exec vitest run test/mock.test.ts`

- [ ] **Step 5: `mock.ts`**:

```ts
import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

export class MockNotifier implements Notifier {
  readonly sent: NotificationMessage[] = [];
  constructor(private readonly opts: { failChannels?: ("email" | "sms")[] } = {}) {}
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    this.sent.push(msg);
    if (this.opts.failChannels?.includes(msg.channel)) {
      return { ok: false, error: `mock: ${msg.channel} delivery failed` };
    }
    return { ok: true, providerId: `mock-${this.sent.length}` };
  }
}
```

- [ ] **Step 6: `index.ts`** barrel:

```ts
export type { DeliveryChannel, NotificationMessage, DeliveryResult, Notifier } from "./contracts";
export { MockNotifier } from "./mock";
```

- [ ] **Step 7: Run — expect PASS.** Then `pnpm --filter @chronicle/notifications typecheck`.

- [ ] **Step 8: Commit** `feat(notifications): add Notifier seam + MockNotifier`.

---

### Task 2: Generalize the `JobQueue` seam to a per-job-name payload map

**Why:** The queue is typed to stories (`JobPayload.storyId`, dedup by `storyId`). Make it generic so it can carry `invite.send` without narrowing churn in pipeline handlers.

**Files:**
- Modify: `packages/pipeline/src/contracts.ts` (JobName/JobPayload/JobQueue/JobHandler)
- Modify: `packages/pipeline/src/job-queue.ts` (dedup + attempt key)
- Modify: `packages/queue-inngest/src/index.ts` (signature only; payload hashed already)
- Test: `packages/pipeline/test/job-queue.test.ts` (add invite-job cases; keep existing green)

- [ ] **Step 1: Failing test** — add to `packages/pipeline/test/job-queue.test.ts` (create if absent, else append): enqueue an `invite.send` job and assert it dedupes by `invitationId`, and that a story job still dedupes by `storyId`:

```ts
import { describe, expect, it } from "vitest";
import { InProcessJobQueue } from "../src/job-queue";

describe("InProcessJobQueue invite jobs", () => {
  it("dedupes invite.send by invitationId while pending", async () => {
    const q = new InProcessJobQueue();
    const id1 = await q.enqueue("invite.send", { invitationId: "inv-1", token: "t", channels: ["email"] });
    const id2 = await q.enqueue("invite.send", { invitationId: "inv-1", token: "t", channels: ["email"] });
    expect(id1).toBe(id2);
    expect(q.pending()).toHaveLength(1);
  });

  it("keeps invite and story jobs in separate dedupe namespaces", async () => {
    const q = new InProcessJobQueue();
    await q.enqueue("transcribe", { storyId: "s-1" });
    await q.enqueue("invite.send", { invitationId: "s-1", token: "t", channels: ["sms"] });
    expect(q.pending()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (type error / wrong dedupe):
  `pnpm --filter @chronicle/pipeline exec vitest run test/job-queue.test.ts`

- [ ] **Step 3: Edit `contracts.ts`** — replace the JobName/JobPayload/JobQueue block (lines ~128–186) with a generic map. Keep the existing story payload shape as `StoryJobPayload`:

```ts
export type DeliveryChannel = "email" | "sms";

export interface StoryJobPayload {
  storyId: string;
  attempt?: number;
}

export interface InviteJobPayload {
  invitationId: string;
  token: string;
  channels: DeliveryChannel[];
}

/** Maps each job name to its payload type. Adding a job = a deliberate, named entry here. */
export interface JobPayloadMap {
  transcribe: StoryJobPayload;
  render_story: StoryJobPayload;
  "invite.send": InviteJobPayload;
}

export type JobName = keyof JobPayloadMap;
export type JobPayload = JobPayloadMap[JobName];

export interface EnqueuedJob {
  id: string;
  name: JobName;
  payload: JobPayload;
  enqueuedAt: Date;
  attempts: number;
}

export type JobHandler<N extends JobName = JobName> = (payload: JobPayloadMap[N]) => Promise<void>;
export interface JobFailureInfo { message: string; name?: string }
export type JobFailureHandler<N extends JobName = JobName> = (
  payload: JobPayloadMap[N],
  error: JobFailureInfo,
) => Promise<void>;

/** Per-name dedupe/attempt key: story jobs key on storyId, invite jobs on invitationId. */
export function jobDedupeKey<N extends JobName>(name: N, payload: JobPayloadMap[N]): string {
  if (name === "invite.send") return `invite.send|${(payload as InviteJobPayload).invitationId}`;
  const p = payload as StoryJobPayload;
  return `${name}|${p.storyId}${p.attempt !== undefined ? `|${p.attempt}` : ""}`;
}

export interface JobQueue {
  enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string>;
  register<N extends JobName>(name: N, handler: JobHandler<N>, onFailure?: JobFailureHandler<N>): void;
  drain(): Promise<void>;
  pending(): EnqueuedJob[];
}
```

Note: preserve the existing doc-comments for `attempt` and the failure semantics — move them onto the new types.

- [ ] **Step 4: Edit `job-queue.ts`** — use `jobDedupeKey` for both the pending-dedupe and the attempt cap. Store handlers as `Map<JobName, JobHandler>`. Replace the `payload.storyId` dedupe check (line ~35) with:

```ts
const key = jobDedupeKey(name, payload);
const existing = this.queue.find((j) => jobDedupeKey(j.name, j.payload) === key);
```

and the attempt key (line ~70) with `const key = jobDedupeKey(job.name, job.payload);`. The `register` cast: `this.handlers.set(name, handler as JobHandler)`. The internal maps use the non-generic `JobHandler`/`JobFailureHandler`; the generic is only on the public method signatures.

- [ ] **Step 5: Edit `packages/queue-inngest/src/index.ts`** — update the `enqueue`/`register` signatures to the generic form; the payload sha256 dedupe id and per-name InngestFunction creation are payload-shape-agnostic and need no logic change. Verify `pnpm --filter @chronicle/queue-inngest typecheck`.

- [ ] **Step 6: Run pipeline tests — expect PASS** (new + all existing):
  `pnpm --filter @chronicle/pipeline test && pnpm --filter @chronicle/pipeline typecheck`

- [ ] **Step 7: Commit** `refactor(pipeline): generalize JobQueue to a per-job-name payload map; add invite.send`.

---

### Task 3: DB — invitations delivery columns + `inviteePhone`, migration 0020, `CreateInvitationInput`

**Files:**
- Modify: `packages/db/src/schema.ts` (invitations table, ~lines 907–950)
- Generate: `packages/db/drizzle/migrations/0020_*.sql` + updated `drizzle/schema.sql` (via `db:generate`)
- Modify: `packages/core/src/invitations.ts` (`CreateInvitationInput` + insert)
- Test: `packages/core/test/invitations.test.ts` (assert phone persists)

- [ ] **Step 1: Add columns** to the `invitations` table object (after `inviteeEmail`):

```ts
    /** Optional E.164 phone the invite was addressed to (SMS channel). */
    inviteePhone: text("invitee_phone"),
    /** Channels delivery was requested on at enqueue time (e.g. {email,sms}). */
    deliveryChannels: text("delivery_channels").array(),
    /** Set when at least one channel delivered successfully. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Last delivery error string, if a channel failed. */
    deliveryError: text("delivery_error"),
    /** Incremented by the delivery worker on each attempt. */
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
```

Ensure `integer` is imported from `drizzle-orm/pg-core` in this file (check existing imports; add if missing).

- [ ] **Step 2: Extend `CreateInvitationInput` + insert** in `invitations.ts`: add `inviteePhone?: string` to the interface, and `inviteePhone: input.inviteePhone ?? null` in the `invitations` insert values.

- [ ] **Step 3: Failing test** — in `invitations.test.ts`, extend the create test to pass `inviteePhone: "+15551230000"` and assert the stored row (read via the content subpath already used in that test file) has `inviteePhone === "+15551230000"` and `deliveryAttempts === 0`.

- [ ] **Step 4: Run — expect FAIL** then implement (Steps 1–2 already do). Run:
  `pnpm --filter @chronicle/core exec vitest run test/invitations.test.ts` — expect PASS (PGlite applies the snapshot, so the new columns exist without a migration step in tests).

- [ ] **Step 5: Regenerate schema artifacts + migration:**
  `pnpm --filter @chronicle/db db:generate`
  Confirm a new `0020_*.sql` appears with additive `ADD COLUMN` statements and `drizzle/schema.sql` is updated. Make the migration idempotent-safe per the preview-migrates-prod hazard: hand-edit each added column to `ADD COLUMN IF NOT EXISTS` (memory: `project_preview_deploys_migrate_prod`).

- [ ] **Step 6: Drift guard:** `pnpm --filter @chronicle/db test` (migration-drift test must be green).

- [ ] **Step 7: Commit** `feat(db): invitations delivery columns + inviteePhone (migration 0020)`.

---

### Task 4: `normalizePhone` util (libphonenumber-js)  — parallelizable after Task 1

**Files:**
- Modify: `packages/notifications/package.json` (add `libphonenumber-js`)
- Create: `packages/notifications/src/phone.ts`
- Modify: `packages/notifications/src/index.ts` (export)
- Test: `packages/notifications/test/phone.test.ts`

- [ ] **Step 1: Add dep** `"libphonenumber-js": "^1.11.0"` to dependencies; `pnpm install`.

- [ ] **Step 2: Failing test** `phone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/phone";

describe("normalizePhone", () => {
  it("normalizes a US national number to E.164", () => {
    expect(normalizePhone("(555) 123-0000", "US")).toBe("+15551230000");
  });
  it("passes through a valid E.164 number", () => {
    expect(normalizePhone("+442071838750", "US")).toBe("+442071838750");
  });
  it("returns null for junk", () => {
    expect(normalizePhone("not a phone", "US")).toBeNull();
  });
  it("returns null for empty", () => {
    expect(normalizePhone("", "US")).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: `phone.ts`:**

```ts
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Returns the E.164 form of `raw` (e.g. "+15551230000") or null if it is not a valid number. */
export function normalizePhone(raw: string, defaultRegion: CountryCode = "US"): string | null {
  if (!raw?.trim()) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}
```

- [ ] **Step 5: Export** from `index.ts`: `export { normalizePhone } from "./phone";`

- [ ] **Step 6: Run — expect PASS**; `typecheck`.

- [ ] **Step 7: Commit** `feat(notifications): E.164 normalizePhone util`.

---

### Task 5: Resend email adapter — parallelizable after Task 1

**Files:**
- Modify: `packages/notifications/package.json` (add `resend`)
- Create: `packages/notifications/src/resend.ts`
- Modify: `packages/notifications/src/index.ts` (export)
- Test: `packages/notifications/test/resend.test.ts`

- [ ] **Step 1: Add dep** `"resend": "^4.0.0"`; `pnpm install`.

- [ ] **Step 2: Failing test** — inject a fake Resend client (constructor takes the client, so no live network). Assert an email `NotificationMessage` maps to `emails.send({ from, to, subject, text, html })` and a thrown SDK error becomes `{ ok: false, error }`; assert `send` on an `sms` message throws (this adapter is email-only):

```ts
import { describe, expect, it, vi } from "vitest";
import { ResendEmailAdapter } from "../src/resend";

const fakeClient = (send: any) => ({ emails: { send } }) as any;

describe("ResendEmailAdapter", () => {
  it("maps an email message to resend.emails.send and returns providerId", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "re_1" }, error: null });
    const a = new ResendEmailAdapter(fakeClient(send), "Chronicle <no-reply@x.app>");
    const r = await a.send({ channel: "email", to: "a@b.com", subject: "S", text: "T", html: "<p>T</p>" });
    expect(send).toHaveBeenCalledWith({ from: "Chronicle <no-reply@x.app>", to: "a@b.com", subject: "S", text: "T", html: "<p>T</p>" });
    expect(r).toEqual({ ok: true, providerId: "re_1" });
  });
  it("returns ok:false on a resend error payload", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "bad" } });
    const a = new ResendEmailAdapter(fakeClient(send), "x");
    expect(await a.send({ channel: "email", to: "a@b.com", subject: "S", text: "T" })).toEqual({ ok: false, error: "bad" });
  });
  it("rejects a non-email message", async () => {
    const a = new ResendEmailAdapter(fakeClient(vi.fn()), "x");
    await expect(a.send({ channel: "sms", to: "+1", text: "T" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: `resend.ts`** (the ONLY file importing `resend`):

```ts
import { Resend } from "resend";
import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

type ResendLike = Pick<Resend, "emails">;

/** Email adapter. `from` is a verified Resend sender. Construct the client in the app runtime. */
export class ResendEmailAdapter implements Notifier {
  constructor(private readonly client: ResendLike, private readonly from: string) {}
  static fromApiKey(apiKey: string, from: string): ResendEmailAdapter {
    return new ResendEmailAdapter(new Resend(apiKey), from);
  }
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    if (msg.channel !== "email") throw new Error("ResendEmailAdapter handles email only");
    const { data, error } = await this.client.emails.send({
      from: this.from, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}),
    } as any);
    if (error) return { ok: false, error: error.message };
    return { ok: true, providerId: data?.id };
  }
}
```

- [ ] **Step 5: Export** `export { ResendEmailAdapter } from "./resend";`

- [ ] **Step 6: Run — expect PASS**; `typecheck`.

- [ ] **Step 7: Commit** `feat(notifications): Resend email adapter`.

---

### Task 6: Twilio SMS adapter — parallelizable after Task 1

**Files:**
- Modify: `packages/notifications/package.json` (add `twilio`)
- Create: `packages/notifications/src/twilio.ts`
- Modify: `packages/notifications/src/index.ts` (export)
- Test: `packages/notifications/test/twilio.test.ts`

- [ ] **Step 1: Add dep** `"twilio": "^5.3.0"`; `pnpm install`.

- [ ] **Step 2: Failing test** — inject a fake Twilio client `{ messages: { create } }`. Assert an sms message maps to `messages.create({ from, to, body })` → `{ ok: true, providerId: sid }`; a thrown error → `{ ok:false }`; an `email` message throws:

```ts
import { describe, expect, it, vi } from "vitest";
import { TwilioSmsAdapter } from "../src/twilio";

const fake = (create: any) => ({ messages: { create } }) as any;

describe("TwilioSmsAdapter", () => {
  it("maps an sms message to messages.create and returns the sid", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    const a = new TwilioSmsAdapter(fake(create), "+15550001111");
    const r = await a.send({ channel: "sms", to: "+15551230000", text: "join: link" });
    expect(create).toHaveBeenCalledWith({ from: "+15550001111", to: "+15551230000", body: "join: link" });
    expect(r).toEqual({ ok: true, providerId: "SM1" });
  });
  it("returns ok:false when the client throws", async () => {
    const create = vi.fn().mockRejectedValue(new Error("21610 unsubscribed"));
    const a = new TwilioSmsAdapter(fake(create), "+1");
    expect(await a.send({ channel: "sms", to: "+1", text: "x" })).toEqual({ ok: false, error: "21610 unsubscribed" });
  });
  it("rejects a non-sms message", async () => {
    const a = new TwilioSmsAdapter(fake(vi.fn()), "+1");
    await expect(a.send({ channel: "email", to: "a@b.com", subject: "s", text: "t" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: `twilio.ts`** (the ONLY file importing `twilio`):

```ts
import twilio from "twilio";
import type { DeliveryResult, Notifier, NotificationMessage } from "./contracts";

interface TwilioLike { messages: { create(opts: { from: string; to: string; body: string }): Promise<{ sid: string }> } }

/** SMS adapter. `from` is a Twilio sending number (E.164). */
export class TwilioSmsAdapter implements Notifier {
  constructor(private readonly client: TwilioLike, private readonly from: string) {}
  static fromCredentials(accountSid: string, authToken: string, from: string): TwilioSmsAdapter {
    return new TwilioSmsAdapter(twilio(accountSid, authToken) as unknown as TwilioLike, from);
  }
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    if (msg.channel !== "sms") throw new Error("TwilioSmsAdapter handles sms only");
    try {
      const res = await this.client.messages.create({ from: this.from, to: msg.to, body: msg.text });
      return { ok: true, providerId: res.sid };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 5: Export** `export { TwilioSmsAdapter } from "./twilio";`

- [ ] **Step 6: Run — expect PASS**; `typecheck`.

- [ ] **Step 7: Commit** `feat(notifications): Twilio SMS adapter`.

---

### Task 7: Invite-delivery orchestrator + copy templates (depends on 1,2,3)

**Files:**
- Create: `apps/web/app/_copy/invitations.ts`
- Modify: `apps/web/app/_copy/index.ts` (barrel export)
- Create: `apps/web/lib/deliver-invite.ts` (pure orchestrator)
- Test: `apps/web/__tests__/deliver-invite.test.ts`

The orchestrator is a pure function so it is testable without Inngest. It reads the invitation row (via the content subpath already allow-listed for the invite read path — check `packages/core/test/architecture.test.ts` ALLOWLIST; if `apps/web/lib/deliver-invite.ts` needs a raw content read, prefer adding a read helper to `story-repository.ts`/`invitations.ts` in core instead of reading content tables from web). Since delivery only needs `invitations` (not stories/media), it may read the `invitations` table via a small core helper `getInvitationDeliveryContext(db, invitationId)` returning `{ inviterName, familyName, inviteeName, inviteeEmail, inviteePhone }`. Add that helper to `packages/core/src/invitations.ts` and use it here (keeps web out of the DB content guard entirely).

- [ ] **Step 1: Copy namespace** `_copy/invitations.ts`:

```ts
// Copy for invitation delivery messages (email + SMS). Dynamic bits are arrow fns.
export const invitations = {
  email: {
    subject: (familyName: string) => `You're invited to join ${familyName} on Chronicle`,
    text: (inviterName: string, familyName: string, link: string) =>
      `${inviterName} invited you to join ${familyName} on Chronicle.\n\nOpen this link to accept:\n${link}\n\nThis link is personal to you — please don't forward it.`,
  },
  sms: {
    text: (inviterName: string, link: string) =>
      `${inviterName} invited you to join their family on Chronicle: ${link}`,
  },
} as const;
```

- [ ] **Step 2: Add to `_copy/index.ts`** barrel: `export { invitations } from "./invitations";`

- [ ] **Step 3: Core helper** — add to `packages/core/src/invitations.ts`:

```ts
export interface InvitationDeliveryContext {
  inviterName: string; familyName: string;
  inviteeName: string | null; inviteeEmail: string | null; inviteePhone: string | null;
}
export async function getInvitationDeliveryContext(
  db: Database, invitationId: string,
): Promise<InvitationDeliveryContext | null> {
  const [row] = await db.select({
    inviterName: persons.displayName, familyName: families.name,
    inviteeName: invitations.inviteeName, inviteeEmail: invitations.inviteeEmail, inviteePhone: invitations.inviteePhone,
  }).from(invitations)
    .innerJoin(families, eq(families.id, invitations.familyId))
    .innerJoin(persons, eq(persons.id, invitations.inviterPersonId))
    .where(eq(invitations.id, invitationId)).limit(1);
  if (!row) return null;
  return { inviterName: row.inviterName ?? "", familyName: row.familyName, inviteeName: row.inviteeName, inviteeEmail: row.inviteeEmail, inviteePhone: row.inviteePhone };
}
```

Also add a `recordInviteDelivery(db, invitationId, { deliveredAt?, deliveryError? })` helper that increments `deliveryAttempts` and sets the outcome columns (single UPDATE). Export both from core's barrel (`packages/core/src/index.ts`).

- [ ] **Step 4: Failing test** `apps/web/__tests__/deliver-invite.test.ts` — using the PGlite test DB helper + `MockNotifier`: create a family, an inviter membership, and an invitation with email+phone; call `deliverInvite({ db, notifier, invitationId, token, channels: ["email","sms"], link })`; assert the notifier received one email (subject + body containing the link) and one sms (body containing the link), and that the row's `deliveredAt` is set and `deliveryAttempts === 1`. Add a failure case: `MockNotifier({ failChannels: ["sms"] })` → `deliveryError` recorded, `deliveredAt` still set (email succeeded), and the outbound email body contains `/join/<token>`.

- [ ] **Step 5: Run — expect FAIL.**

- [ ] **Step 6: `deliver-invite.ts`:**

```ts
import type { Database } from "@chronicle/db";
import type { DeliveryChannel, Notifier } from "@chronicle/notifications";
import { getInvitationDeliveryContext, recordInviteDelivery } from "@chronicle/core";
import { invitations as copy } from "@/app/_copy/invitations";

export async function deliverInvite(args: {
  db: Database; notifier: Notifier; invitationId: string; token: string;
  channels: DeliveryChannel[]; link: string;
}): Promise<void> {
  const ctx = await getInvitationDeliveryContext(args.db, args.invitationId);
  if (!ctx) return; // invitation vanished (e.g. revoked); nothing to deliver
  let delivered = false; const errors: string[] = [];
  for (const channel of args.channels) {
    if (channel === "email" && ctx.inviteeEmail) {
      const r = await args.notifier.send({ channel: "email", to: ctx.inviteeEmail,
        subject: copy.email.subject(ctx.familyName),
        text: copy.email.text(ctx.inviterName, ctx.familyName, args.link) });
      r.ok ? (delivered = true) : errors.push(`email: ${r.error}`);
    } else if (channel === "sms" && ctx.inviteePhone) {
      const r = await args.notifier.send({ channel: "sms", to: ctx.inviteePhone,
        text: copy.sms.text(ctx.inviterName, args.link) });
      r.ok ? (delivered = true) : errors.push(`sms: ${r.error}`);
    }
  }
  await recordInviteDelivery(args.db, args.invitationId, {
    deliveredAt: delivered ? new Date() : undefined,
    deliveryError: errors.length ? errors.join("; ") : undefined,
  });
}
```

- [ ] **Step 7: Run — expect PASS**; typecheck the web package.

- [ ] **Step 8: Commit** `feat(web): invite-delivery orchestrator + message copy`.

---

### Task 8: Wire enqueue (server action) + Inngest worker registration (depends on 2,3,7)

**Files:**
- Modify: `apps/web/lib/runtime.ts` (construct `notifier`; register `invite.send` handler)
- Modify: `apps/web/app/api/inngest/route.ts` (ensure the new function is served — it is, if registered through the same JobQueue the route builds handlers from; verify)
- Modify: `apps/web/app/hub/tabs/InviteTab.tsx` (`createMemberInvite`: normalize phone, persist phone, compute channels, enqueue)
- Test: `apps/web/__tests__/create-member-invite.test.ts` (server-action logic extracted to a testable helper)

- [ ] **Step 1:** Extract the enqueue decision into a pure helper `resolveInviteChannels({ email, phone, smsConsent })` in `apps/web/lib/invite-delivery-channels.ts` returning `DeliveryChannel[]` (email if email present; sms if normalized phone present AND consent). Unit-test it (email-only, sms-only, both, neither, phone-without-consent → no sms, invalid-phone handled upstream).

- [ ] **Step 2:** In `runtime.ts`, build `notifier`: if `RESEND_API_KEY`/Twilio creds present, construct the real adapters and a small composite `Notifier` that routes by `msg.channel` to the right adapter; else `MockNotifier`. Register the `invite.send` handler on the runtime's `JobQueue`:

```ts
queue.register("invite.send", async (p) => {
  const link = `${resolvePublicOrigin(...)}/join/${p.token}`;
  await deliverInvite({ db, notifier, invitationId: p.invitationId, token: p.token, channels: p.channels, link });
});
```

Compose email+sms: since a single `Notifier.send` dispatches by channel, wrap the two adapters:

```ts
const notifier: Notifier = { send: (m) => (m.channel === "email" ? email.send(m) : sms.send(m)) };
```

- [ ] **Step 3:** In `createMemberInvite` (InviteTab.tsx): read `inviteePhone` + `smsConsent` from the form; `normalizePhone`; if a phone was provided but invalid → throw a user-facing error (no invite created). Pass `inviteePhone` into `createInvitation`. Compute `channels = resolveInviteChannels(...)`. After create, if `channels.length` → `queue.enqueue("invite.send", { invitationId, token, channels })`. Persist `deliveryChannels` (either via a new field on `createInvitation` or a follow-up `recordInviteDelivery`-adjacent update — simplest: extend the insert in `createInvitation` to accept `deliveryChannels`). Keep the flash-cookie + redirect.

- [ ] **Step 4:** Test the server-action helper path: assert `queue.enqueue` is called with the right channels when contact+consent present, and NOT called when no contact. (Test `resolveInviteChannels` + a thin integration around `createInvitation` + an in-process queue that captures the enqueue.)

- [ ] **Step 5:** Run web tests + typecheck. Commit `feat(web): enqueue invite delivery + register Inngest worker`.

---

### Task 9: UI — phone field, SMS consent, delivery-status readout (depends on 3,8)

**Files:**
- Modify: `apps/web/app/hub/tabs/InviteTab.tsx` (form fields + result readout)
- Modify: `apps/web/app/_copy/hub.ts` (labels/notes for phone, consent, delivery status)
- Test: `apps/web/__tests__/invite-tab-delivery.test.tsx`

- [ ] **Step 1:** Add copy keys to `hub.invite`: `phoneLabel`, `phoneLabelOptional`, `phonePlaceholder`, `smsConsentLabel` ("I have this person's permission to text them"), `sending`, `deliveredEmail`, `deliveredSms`, `deliveryFailed`.

- [ ] **Step 2:** Add to the member `<form>`: a phone `<input name="inviteePhone" type="tel">` and a `<input type="checkbox" name="smsConsent">` with the consent label. (Consent is only meaningful with a phone; server-side `resolveInviteChannels` already gates sms on both.)

- [ ] **Step 3:** In the member show-once result view (`memberToken` branch), also read the just-created invitation's delivery state and render a one-line status ("Sending to a@b.com and +1…"/"Delivered"/"Couldn't reach — use the link below") beneath the copy-link card. Source the state from the invitation row via a core read by the flash-cookie's invitation id — simplest: the server action also sets a second short-lived cookie with the invitationId + channels so the result view can show "Sending to …" without a DB round-trip; a later refresh reads `deliveredAt`/`deliveryError` via `getInvitationDeliveryContext` + a status read. Keep it minimal: show "Sending to {targets}" immediately; the copy-link stays as the guaranteed fallback.

- [ ] **Step 4:** Test (RTL, mirroring existing `invite-tab-*` tests): the member form renders phone + consent inputs; the result view renders the "sending" line + copy-link.

- [ ] **Step 5:** Run web tests + typecheck. Commit `feat(web): invite form phone + SMS consent + delivery status`.

---

### Task 10: Architecture guard + DECISIONS.md + final preflight (depends on all)

**Files:**
- Modify: `packages/pipeline/test/pipeline.test.ts` (SDK-import guard roots + carve-outs)
- Modify: `docs/DECISIONS.md`
- Modify: root/workspace config if needed so `@chronicle/notifications` is part of `pnpm -r`

- [ ] **Step 1:** Add `"packages/notifications/src"` to the scanned `roots` array (line ~606). Add `resend.ts` and `twilio.ts` to the adapter carve-out allowlist (mirroring the `r2.ts` exception) so the guard permits `resend`/`twilio`/`libphonenumber-js` imports ONLY there and fails CI on any such import elsewhere in the scanned trees. Add a test asserting the guard flags a hypothetical stray import (follow the existing test's structure).

- [ ] **Step 2:** `docs/DECISIONS.md` — append: Resend = default email `Notifier`; Twilio = default SMS adapter; async invite delivery persists the plaintext token in the Inngest job payload (deliberate, accepted weakening of the never-persist-token invariant — see spec). Update the vendor-defaults list.

- [ ] **Step 3:** Run the guard test: `pnpm --filter @chronicle/pipeline exec vitest run test/pipeline.test.ts` — expect PASS.

- [ ] **Step 4:** Commit `test(arch): guard notifications SDK imports; docs(decisions): invite delivery vendors + token tradeoff`.

- [ ] **Step 5 (main agent):** Full CI-equivalent preflight before any push:
  `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm --filter @chronicle/web build && pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle`
  Then open a PR (do not push to master directly).

---

## Self-review notes

- **Spec coverage:** package/seam (T1), JobQueue generalization (T2), schema+migration+phone field (T3), normalizePhone (T4), Resend (T5), Twilio (T6), orchestrator+copy (T7), enqueue+worker (T8), UI+consent+status (T9), architecture guard + DECISIONS + preflight (T10). All spec sections mapped.
- **Token tradeoff** is carried into DECISIONS (T10) and the enqueue payload (T2/T8) as specified.
- **DB content guard:** delivery reads go through core helpers (`getInvitationDeliveryContext`), keeping `apps/web` out of the `@chronicle/db/content` guard — no ALLOWLIST edit needed.
- **Deferred (unchanged):** narrator-flow delivery, rate-limiting, delivery webhooks, A2P 10DLC ops, full pending-invites list.
```
