/**
 * Increment 4B, Task 4.6 — the pending-only empty hub.
 *
 * With routing Gate C retired, a pending-only user (no active membership, one pending join request)
 * now reaches /hub with `activeFamilies.length === 0`, `scope === "all"`, and an empty feed. The read
 * tabs must render a coherent, welcoming empty state (not the "when someone shares…" copy that assumes
 * an existing family), the Invite/Requests tabs must be absent, and nothing may throw on zero families.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";
import { AlbumSurface } from "@/app/hub/album/AlbumSurface";
import { inviteTabVisible, requestsTabVisible } from "@/lib/hub-tabs";
import { hub } from "@/app/_copy";

// renderToStaticMarkup HTML-escapes apostrophes (you'll → you&#x27;ll), so match on the distinctive
// leading fragment of the pending-only copy rather than the full string with its apostrophes.
const PENDING_FRAGMENT = "Nothing here yet";

async function makePerson(db: Database, name: string): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

describe("pending-only hub — Stories tab", () => {
  it("renders the pending-only empty copy (not the generic stories empty) and does not throw", () => {
    const html = renderToStaticMarkup(
      StoriesTab({
        feed: [],
        viewerPersonId: "viewer",
        seenStoryIds: new Set(),
        familyTargets: new Map(),
        storyCovers: new Map(),
        viewerFamilies: [], // member of no family
        viewerName: "You",
        selfDrafts: [],
        scope: "all",
      }),
    );
    expect(html).toContain(PENDING_FRAGMENT);
    expect(html).not.toContain(hub.stories.empty);
  });
});

describe("pending-only hub — Album tab", () => {
  it("renders the pending-only empty copy for a viewer with no families", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Newcomer");
    const ctx: AuthContext = { kind: "account", personId: viewer };

    const html = renderToStaticMarkup(await AlbumSurface({ db, ctx, scope: "all" }));

    expect(html).toContain(PENDING_FRAGMENT);
    expect(html).not.toContain(hub.album.empty);
  });
});

describe("pending-only hub — no Invite/Requests tabs", () => {
  it("hides both member-only tabs when the viewer belongs to no family", () => {
    expect(inviteTabVisible(0)).toBe(false);
    // Even if a stray request row existed, a member-of-none has no steward queue.
    expect(requestsTabVisible(0, 1, 1)).toBe(false);
  });
});
