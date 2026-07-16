/**
 * Issue #78 — Basic story receipt (regression).
 *
 * The receipt path is: a family reliably RECEIVES and EXPERIENCES a newly-approved story. The
 * list→detail→audio+prose+transcript surface is already built (`apps/web/app/hub/**`) and every
 * read goes through the single front door in `authorization.ts`. This test bonds the whole chain
 * end-to-end at the front door — the guarantee the UI depends on — so a regression in any arm
 * (visibility predicate, single-item gate, media gate, or the derived-content payload) fails here.
 *
 * It asserts BOTH directions, per the acceptance criteria:
 *   - An authorized family member locates the newly-approved story (list), opens it (single-item
 *     gate), receives the FULL experience payload (original-voice `recordingMediaId` + cleaned
 *     `prose` + `transcript`), and can play the original audio (media gate → bytes-bearing Media).
 *   - An unauthorized non-family viewer is blocked at every seam: not in the list, `null` on the
 *     story, and `null` on the recording — no content and no oracle about existence.
 *
 * Scope is receipt-only: it exercises the read/authorization path, not any timeline/feed/gallery.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getMediaForViewer,
  getStoryForViewer,
  listStoriesForViewer,
  type AuthContext,
} from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
  revokeConsent,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

// The content a receiving member should experience — original-voice audio plus its cleaned prose
// and verbatim transcript. Distinctive strings so we can assert the exact payload was delivered.
const PROSE = "We took the train to Naples the summer I turned nine.";
const TRANSCRIPT = "uh so we — we took the train to Naples, the summer I turned nine.";
const SUMMARY = "A childhood train trip to Naples.";
const TITLE = "The train to Naples";

/**
 * Eleanor narrates a story and shares it into the Boudreaux family; Sofia is a co-member (the
 * intended audience); Mallory is a stranger with no shared family. Returns the cast + the shared
 * story and its recording.
 */
async function sharedStoryWorld() {
  const eleanor = await makePerson(db, "Eleanor");
  const sofia = await makePerson(db, "Sofia");
  const mallory = await makePerson(db, "Mallory");
  const fam = await makeFamily(db, "Boudreaux", eleanor.id);
  await addMembership(db, eleanor.id, fam.id, "active");
  await addMembership(db, sofia.id, fam.id, "active");
  // Mallory is in no family with Eleanor.
  const { story, recording } = await makeStory(db, {
    ownerPersonId: eleanor.id,
    state: "shared",
    audienceTier: "family",
    withApprovalConsent: true,
    targetFamilyIds: [fam.id],
    title: TITLE,
    prose: PROSE,
    transcript: TRANSCRIPT,
    summary: SUMMARY,
  });
  return { eleanor, sofia, mallory, fam, story, recording };
}

describe("story receipt — the authorized family member fully experiences a new story", () => {
  it("locates the newly-approved story from the hub list", async () => {
    const { sofia, eleanor, story } = await sharedStoryWorld();
    const visible = await listStoriesForViewer(db, account(sofia.id), {
      ownerPersonId: eleanor.id,
    });
    expect(visible.map((s) => s.id)).toContain(story.id);
  });

  it("opens the detail and receives the full experience payload (audio + prose + transcript)", async () => {
    const { sofia, story, recording } = await sharedStoryWorld();
    const received = await getStoryForViewer(db, account(sofia.id), story.id);
    expect(received).not.toBeNull();
    // Original-voice audio: the detail page renders /api/media/{recordingMediaId}.
    expect(received!.recordingMediaId).toBe(recording.id);
    // Cleaned prose + verbatim transcript both travel to the reader.
    expect(received!.prose).toBe(PROSE);
    expect(received!.transcript).toBe(TRANSCRIPT);
    expect(received!.title).toBe(TITLE);
    expect(received!.summary).toBe(SUMMARY);
  });

  it("plays the original-voice audio (media front door returns the bytes-bearing recording)", async () => {
    const { sofia, recording } = await sharedStoryWorld();
    const media = await getMediaForViewer(db, account(sofia.id), recording.id);
    expect(media).not.toBeNull();
    // The route streams storage.getBytes(storageKey); the member gets a real, addressable asset.
    expect(media!.id).toBe(recording.id);
    expect(media!.storageKey).toBe(recording.storageKey);
    expect(media!.contentType).toBe("audio/wav");
  });
});

describe("story receipt — an unauthorized viewer receives nothing (single front door)", () => {
  it("a stranger cannot locate, open, or play the story", async () => {
    const { mallory, eleanor, story, recording } = await sharedStoryWorld();

    // Not in the list...
    const listed = await listStoriesForViewer(db, account(mallory.id), {
      ownerPersonId: eleanor.id,
    });
    expect(listed.map((s) => s.id)).not.toContain(story.id);

    // ...null on the story (indistinguishable from "does not exist")...
    expect(await getStoryForViewer(db, account(mallory.id), story.id)).toBeNull();

    // ...and null on the original-voice recording (no direct-media bypass).
    expect(await getMediaForViewer(db, account(mallory.id), recording.id)).toBeNull();
  });

  it("revocation retracts a previously-received story from the family member (whole chain)", async () => {
    const { eleanor, sofia, story, recording } = await sharedStoryWorld();
    // Received first.
    expect(await getStoryForViewer(db, account(sofia.id), story.id)).not.toBeNull();
    expect(
      await getMediaForViewer(db, account(sofia.id), recording.id),
    ).not.toBeNull();

    // A new superseding consent row revokes sharing (append-only — never an edit).
    await revokeConsent(db, story.id, eleanor.id);

    // The story — and its audio — disappear from the family member across the whole chain.
    const listed = await listStoriesForViewer(db, account(sofia.id), {
      ownerPersonId: eleanor.id,
    });
    expect(listed.map((s) => s.id)).not.toContain(story.id);
    expect(await getStoryForViewer(db, account(sofia.id), story.id)).toBeNull();
    expect(await getMediaForViewer(db, account(sofia.id), recording.id)).toBeNull();
  });
});
