/**
 * Task 9 — invite delivery-status UI readout.
 *
 * Delivery (email/SMS) is dispatched off the request path, so after submit the inviter otherwise
 * sees only the copy-link with no sign anything was sent. These tests pin:
 *
 *  1. The member form still renders the phone input + SMS-consent checkbox (prior task; regression
 *     pin so this task doesn't regress it).
 *  2. When BOTH the member token flash cookie and the new targets flash cookie are present, the
 *     result view renders a "Sending your invitation to <targets>" line AND still renders the
 *     copy-link fallback.
 *  3. When only the member token cookie is present (no targets cookie — e.g. no contact given), the
 *     result view renders the copy-link WITHOUT a sending line.
 *
 * InviteTab is an async server component reading `@/lib/runtime` + `next/headers`; both are mocked,
 * mirroring invite-tab-family-guard.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let cookieStore: Record<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore[name] !== undefined ? { value: cookieStore[name] } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => ({ get: () => null }),
}));

let runtimeDb: Database;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => ({ kind: "account", personId: viewerId }) },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, persons } from "@chronicle/db/schema";
import { InviteTab } from "@/app/hub/tabs/InviteTab";
import { parseFamilyFilter } from "@/lib/family-filter";
import {
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_TARGETS_FLASH_COOKIE,
} from "@/lib/invite-flash";

let viewerId: string;
let familyId: string;

async function setup(): Promise<void> {
  runtimeDb = await createTestDatabase();
  const [p] = await runtimeDb.insert(persons).values({ displayName: "Rosa", spokenName: "Rosa" }).returning();
  viewerId = p!.id;
  const [f] = await runtimeDb
    .insert(families)
    .values({ name: "Esposito", creatorPersonId: viewerId, stewardPersonId: viewerId })
    .returning();
  familyId = f!.id;
}

async function render(): Promise<string> {
  const filter = parseFamilyFilter(undefined, [familyId]);
  return renderToStaticMarkup(
    await InviteTab({ families: [{ id: familyId, name: "Esposito" }], filter }),
  );
}

describe("InviteTab — member form pins phone + SMS consent (regression)", () => {
  it("renders the phone input and SMS-consent checkbox in the member form", async () => {
    await setup();
    cookieStore = {};
    const html = await render();
    expect(html).toContain('name="inviteePhone"');
    expect(html).toContain('name="smsConsent"');
  });
});

describe("InviteTab — delivery 'sending to' confirmation (Task 9)", () => {
  it("renders the sending-to line and the copy-link fallback when both flash cookies are present", async () => {
    await setup();
    cookieStore = {
      [MEMBER_INVITE_FLASH_COOKIE]: "tok123",
      [MEMBER_INVITE_TARGETS_FLASH_COOKIE]: "rosa@example.com, +15551230000",
    };
    const html = await render();

    expect(html).toContain("Sending your invitation to rosa@example.com, +15551230000");
    expect(html).toContain("/join/tok123");
  });

  it("renders only the copy-link, with NO sending line, when the targets cookie is absent", async () => {
    await setup();
    cookieStore = {
      [MEMBER_INVITE_FLASH_COOKIE]: "tok456",
    };
    const html = await render();

    expect(html).toContain("/join/tok456");
    expect(html).not.toContain("Sending your invitation");
  });
});
