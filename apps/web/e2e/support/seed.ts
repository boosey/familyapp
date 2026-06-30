import type { APIRequestContext } from "@playwright/test";
import { tinyWav } from "../../lib/wav-util";

/**
 * Shape of the `POST /api/dev/seed` response (see apps/web/app/api/dev/seed/route.ts).
 * `narratorLink` is the ready-to-open `/s/<token>` capture surface for the seeded narrator
 * (Eleanor); it is `null` only in a degraded Clerk-mode seed, which the hermetic test env
 * never hits (Clerk is disabled), so tests can treat it as present.
 */
export interface SeedResult {
  ok: boolean;
  narratorPersonId: string;
  draftStoryId: string;
  narratorLink: string | null;
}

/**
 * Reseed the dev dataset (TRUNCATE + recreate) and return the fresh tokens/ids.
 *
 * The seed is global state shared by the whole (serial) suite, so call this in a spec's
 * `beforeAll` to give that file a known, independent starting point.
 */
export async function reseed(request: APIRequestContext): Promise<SeedResult> {
  const res = await request.post("/api/dev/seed");
  if (!res.ok()) {
    throw new Error(`/api/dev/seed failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as SeedResult;
  if (!body.ok) {
    throw new Error(`/api/dev/seed returned ok:false — ${JSON.stringify(body)}`);
  }
  return body;
}

/** The seeded narrator's display name — used as the one-click "Become <name>" target on /dev/sign-in. */
export const SEEDED_NARRATOR_NAME = "Eleanor";

/**
 * The raw link-session token from a seed result. `narratorLink` is `/s/<token>`; the capture/approve
 * API seams want the bare token (the token IS the narrator's identity on the login-free surface).
 */
export function narratorTokenOf(seed: SeedResult): string {
  const link = seed.narratorLink;
  if (!link) throw new Error("seed has no narratorLink (degraded seed?)");
  const token = link.split("/s/")[1];
  if (!token) throw new Error(`could not parse token from narratorLink: ${link}`);
  return token;
}

/**
 * A Playwright multipart file part wrapping the shared synthetic WAV (lib/wav-util.ts — the same
 * bytes the dev seed uses). The offline ScriptedTranscriber ignores audio content, so silence is
 * sufficient to exercise the record/approve seams deterministically; a real WAV (not arbitrary
 * bytes) ensures nothing downstream chokes on the container.
 */
export function wavPart(name = "audio.wav") {
  return { name, mimeType: "audio/wav", buffer: Buffer.from(tinyWav()) };
}
