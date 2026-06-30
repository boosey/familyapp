import { test, expect } from "@playwright/test";
import { reseed, type SeedResult } from "./support/seed";

/**
 * The `/s/[token]` narrator capture surface — the Phase-1 wedge. The URL token IS the identity:
 * no login. A valid token opens the recording screen; an unresolvable token fails WARMLY.
 */
test.describe("/s/[token] narrator capture", () => {
  let seed: SeedResult;

  test.beforeAll(async ({ request }) => {
    seed = await reseed(request);
    expect(seed.narratorLink, "seed should return a narrator link").toBeTruthy();
  });

  test("a valid session token opens the recording screen", async ({ page }) => {
    await page.goto(seed.narratorLink!);

    // The capture header renders "Conversation · <date>" — present only on a resolved session.
    await expect(page.getByText(/Conversation ·/)).toBeVisible();

    // And it is NOT the warm "resting" fallback.
    await expect(page.getByText("This link is resting for now.")).toHaveCount(0);
  });

  test("an unresolvable token fails warmly toward the human", async ({ page }) => {
    await page.goto("/s/this-token-does-not-resolve");

    await expect(page.getByRole("heading", { name: "Welcome." })).toBeVisible();
    await expect(page.getByText("This link is resting for now.")).toBeVisible();
  });
});
