/**
 * Asks tab — the asker's outbox. Shows submitted questions and their status; links answered ones
 * to the resulting Story (via the authorization function so only permitted content is visible).
 *
 * Server component: fetches ALL of the viewer's asks (every row already per-row authorized), enriches
 * each with story visibility, and hands the whole set — plus the viewer's families and a SEED family
 * id from the current `?families=` filter — to <AsksDesignator> (a client component that holds the
 * designated family in local state and filters client-side; ADR-0021 DESIGNATOR mode, no URL write).
 */
import { getStoryForViewer, listAsksByAsker } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { AsksDesignator, type AsksDesignatorAsk } from "./AsksDesignator";
import { cardTilt } from "./card-tilt";
import styles from "./AsksDesignator.module.css";

export async function AsksTab({
  families = [],
  seedFamilyId = "all",
  hasFamily = true,
}: {
  families?: { id: string; name: string; shortName?: string | null }[];
  seedFamilyId?: string;
  hasFamily?: boolean;
} = {}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return <p className={styles.signedOut}>{hub.asks.signedOut}</p>;
  }

  // Fetch EVERY ask the viewer sent (no server-side family narrowing — the designator narrows on the
  // client). Each ask carries its full `familyIds` so the client can filter without a refetch.
  const mine = await listAsksByAsker(db, ctx);
  const enriched: AsksDesignatorAsk[] = await Promise.all(
    mine.map(async (m) => {
      let storyVisible = false;
      let storyTitle: string | null = null;
      if (m.ask.status === "answered" && m.ask.storyId) {
        const story = await getStoryForViewer(db, ctx, m.ask.storyId);
        if (story) {
          storyVisible = true;
          storyTitle = story.title;
        }
      }
      return {
        id: m.ask.id,
        questionText: m.ask.questionText,
        status: m.ask.status,
        storyId: m.ask.storyId,
        targetSpokenName: m.targetSpokenName,
        familyIds: m.familyIds,
        storyVisible,
        storyTitle,
      };
    }),
  );

  // A pending-only viewer (member of no family) gets the coherent hub-wide empty state — they have no
  // family to designate and nothing to have asked. A member who simply hasn't asked anything falls
  // through to <AsksDesignator>'s own asks-specific empty (Task 4.6).
  if (!hasFamily && enriched.length === 0) {
    return (
      <div>
        <h2 className={styles.title}>{hub.asks.title}</h2>
        <p className={styles.intro}>{hub.asks.intro}</p>
        <div className={styles.empty} style={cardTilt(0)}>
          <p className={styles.emptyText}>{hub.shell.pendingEmpty}</p>
        </div>
      </div>
    );
  }

  return <AsksDesignator families={families} seedFamilyId={seedFamilyId} asks={enriched} />;
}
