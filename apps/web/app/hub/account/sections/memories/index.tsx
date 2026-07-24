/**
 * Account › Memories (ADR-0029 §#357) — lets a Person review and correct what the system remembers
 * about them. Per-narrator, self-only.
 *
 * DATA SOURCE (day-1): the Person's BIOGRAPHICAL ANCHORS (`persons.biographical_anchors`) — the only
 * salient facts actually stored today. Each anchor is surfaced as a "memory" card the person can edit
 * or forget. The richer, story-derived narrator-memory ledger is a separately-tracked fast-follow
 * (#362); this section is built against that ledger's contract now (see `view-model.ts`) so landing it
 * is a data-layer swap in this file — map ledger rows to `MemoryItem` instead of anchors — not a UI
 * rewrite. Anchors carry NO source story, and the UI labels them honestly as profile facts.
 *
 * Owns its own data load, keyed on the shared-contract `personId`/`db`. Section copy is in `./copy.ts`.
 */
import { eq } from "drizzle-orm";
import type { BiographicalProfile } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { notFound } from "next/navigation";
import type { AccountSectionProps } from "../../section-props";
import { MemoriesList } from "./MemoriesList";
import { anchorsToMemoryItems } from "./view-model";
import { memoriesSectionCopy as copy } from "./copy";

export default async function MemoriesSection({ personId, db }: AccountSectionProps) {
  const [row] = await db
    .select({ biographicalAnchors: persons.biographicalAnchors })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  if (!row) notFound();

  const anchors = (row.biographicalAnchors ?? {}) as Partial<BiographicalProfile>;
  const items = anchorsToMemoryItems(anchors);

  return (
    <section aria-labelledby="account-memories-title">
      <MemoriesList items={items} title={copy.title} />
    </section>
  );
}
