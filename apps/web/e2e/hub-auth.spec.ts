import { test, expect } from "@playwright/test";
import { reseed, SEEDED_NARRATOR_NAME } from "./support/seed";

/**
 * Authenticated hub access via the dev one-click sign-in. With Clerk disabled (hermetic env),
 * the local MOCK auth provider is active and `/dev/sign-in` lists every seeded person with a
 * "Become <name>" button that sets the `chronicle_mock_session` cookie and redirects to /hub.
 * This exercises the app's real sign-in mechanism end-to-end rather than poking cookies directly.
 */
test.describe("dev sign-in → hub", () => {
  test.beforeAll(async ({ request }) => {
    await reseed(request);
  });

  test("becoming a seeded person lands on an authenticated hub", async ({ page }) => {
    await page.goto("/dev/sign-in");
    await expect(page.getByRole("heading", { name: "Dev sign-in" })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Become ${SEEDED_NARRATOR_NAME}`) }).first().click();

    // Landed on the hub, signed in.
    await expect(page).toHaveURL(/\/hub\b/);

    // The "Questions for you" tab renders only on the authenticated hub shell...
    await expect(page.getByText("Questions for you")).toBeVisible();
    // ...and the anonymous gate's prompt is absent.
    await expect(page.getByText("Sign in to see your family's stories.")).toHaveCount(0);
  });
});
