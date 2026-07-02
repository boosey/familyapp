/**
 * `resolvePostAuthRoute` — the single post-auth/onboarding/family gate.
 *
 * Regression focus: an onboarded, family-less requester with a PENDING join request routes to
 * `/families/find` (NOT the old `/families/find?pending=1` — that dead param was ignored once the
 * finder grew its own "Your requests" section). The other branches are pinned alongside it.
 */
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { InMemoryMediaStorage } from "@chronicle/storage";
import {
  createAccountWithPerson,
  completeOnboarding,
  createJoinRequest,
} from "@chronicle/core";
import { seedInto } from "../lib/dev-seed";
import { resolvePostAuthRoute } from "../lib/post-auth-route";

async function newOnboardedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>, tag: string) {
  const { personId } = await createAccountWithPerson(db, {
    authProviderUserId: `post-auth-${tag}`,
    email: `post-auth-${tag}@example.test`,
    displayName: `Test ${tag}`,
  });
  await completeOnboarding(db, personId, { year: 1970, month: 6, day: 15 });
  return personId;
}

describe("resolvePostAuthRoute", () => {
  it("routes a not-onboarded person to /welcome", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-fresh",
      email: "post-auth-fresh@example.test",
      displayName: "Fresh Signup",
    });
    // No completeOnboarding → onboardedAt is null.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/welcome");
  });

  it("routes an onboarded, family-less person WITH a pending request to /families/find (no dead param)", async () => {
    const db = await createTestDatabase();
    const { boudreauxFamilyId } = await seedInto(db, new InMemoryMediaStorage());
    const requester = await newOnboardedPerson(db, "pending");
    await createJoinRequest(db, {
      familyId: boudreauxFamilyId!,
      requesterPersonId: requester,
    });
    await expect(resolvePostAuthRoute(db, requester)).resolves.toBe("/families/find");
  });

  it("routes an onboarded, family-less person with NO requests to /families/start", async () => {
    const db = await createTestDatabase();
    await seedInto(db, new InMemoryMediaStorage());
    const wanderer = await newOnboardedPerson(db, "nofamily");
    await expect(resolvePostAuthRoute(db, wanderer)).resolves.toBe("/families/start");
  });

  it("routes an onboarded person who already belongs to a family to /hub", async () => {
    const db = await createTestDatabase();
    const { narratorPersonId } = await seedInto(db, new InMemoryMediaStorage());
    await expect(resolvePostAuthRoute(db, narratorPersonId!)).resolves.toBe("/hub");
  });
});
