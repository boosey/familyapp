/**
 * `resolvePostAuthRoute` — the single post-auth/onboarding/family gate.
 *
 * Regression focus: an onboarded, family-less requester with a PENDING join request now falls
 * through to `/hub` (Gate C deleted — a pending request is a family intent, so the hub admits them
 * rather than parking them on `/families/find`). The other branches are pinned alongside it.
 */
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { InMemoryMediaStorage } from "@chronicle/storage";
import {
  createAccountWithPerson,
  completeOnboarding,
  createJoinRequest,
  createFamily,
} from "@chronicle/core";
import { seedInto } from "../lib/dev-seed";
import { resolvePostAuthRoute } from "../lib/post-auth-route";

async function newOnboardedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>, tag: string) {
  const { personId } = await createAccountWithPerson(db, {
    authProviderUserId: `post-auth-${tag}`,
    email: `post-auth-${tag}@example.test`,
    displayName: `Test ${tag}`,
  });
  await completeOnboarding(db, personId, { displayName: `Test ${tag}`, year: 1970, month: 6, day: 15 });
  return personId;
}

describe("resolvePostAuthRoute", () => {
  it("routes a not-onboarded, family-less person to /families/start (family-first gate)", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-fresh",
      email: "post-auth-fresh@example.test",
      displayName: "Fresh Signup",
    });
    // No family, no request, not onboarded → establish a family first.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/families/start");
  });

  it("routes a not-onboarded person who already has a family to /welcome (DOB before hub)", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-newfam",
      email: "post-auth-newfam@example.test",
      displayName: "New Steward",
    });
    await createFamily(db, { name: "The Test Family", creatorPersonId: personId });
    // Active (steward) membership exists but onboardedAt is still null.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/welcome");
  });

  it("routes a not-onboarded, family-less person WITH a pending request to /welcome (find → DOB)", async () => {
    const db = await createTestDatabase();
    const { boudreauxFamilyId } = await seedInto(db, new InMemoryMediaStorage());
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-findfirst",
      email: "post-auth-findfirst@example.test",
      displayName: "Finder First",
    });
    await createJoinRequest(db, {
      familyId: boudreauxFamilyId!,
      requesterPersonId: personId,
    });
    // Requested to join (pending) but not onboarded → proceed to DOB.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/welcome");
  });

  it("routes an onboarded, family-less person WITH a pending request to /hub (Gate C deleted)", async () => {
    const db = await createTestDatabase();
    const { boudreauxFamilyId } = await seedInto(db, new InMemoryMediaStorage());
    const requester = await newOnboardedPerson(db, "pending");
    await createJoinRequest(db, {
      familyId: boudreauxFamilyId!,
      requesterPersonId: requester,
    });
    // A pending join request IS a family intent → the hub admits them (no auto-park on /families/find).
    await expect(resolvePostAuthRoute(db, requester)).resolves.toBe("/hub");
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
