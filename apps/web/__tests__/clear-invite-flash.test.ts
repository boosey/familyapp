/**
 * Regression test for the invite-link flash cookie.
 *
 * The bug: InviteTab deleted the flash cookie during render (`cookies().delete(...)`), which
 * Next 15 forbids — it throws "Cookies can only be modified in a Server Action or Route Handler",
 * breaking the entire invite result view. The fix moves the show-once deletion into THIS route
 * handler, invoked from a client effect after the link renders. This test pins that the handler
 * deletes the correct cookies (name + path) and returns 204, so the deletion never drifts back
 * into render. The handler clears BOTH show-once flash cookies (the elder-invite link and the
 * member-invite link), since either result view may have set one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: deleteSpy }),
}));

vi.mock("next/server", () => ({
  NextResponse: class {
    body: unknown;
    status: number;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
  },
}));

import { POST } from "../app/api/hub/clear-invite-flash/route";
import {
  INVITE_FLASH_COOKIE,
  INVITE_FLASH_PATH,
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_FLASH_PATH,
} from "../lib/invite-flash";

describe("clear-invite-flash route handler", () => {
  afterEach(() => {
    deleteSpy.mockReset();
  });

  it("deletes both invite flash cookies by name + path and returns 204", async () => {
    const res = (await POST()) as unknown as { status: number };

    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledWith({
      name: INVITE_FLASH_COOKIE,
      path: INVITE_FLASH_PATH,
    });
    expect(deleteSpy).toHaveBeenCalledWith({
      name: MEMBER_INVITE_FLASH_COOKIE,
      path: MEMBER_INVITE_FLASH_PATH,
    });
    expect(res.status).toBe(204);
  });
});
