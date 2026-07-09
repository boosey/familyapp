/**
 * Post-onboarding biographical anchor writes — direct structured updates to
 * `persons.biographical_anchors`. Distinct from the Intake walk (which uses LLM extraction +
 * intake_answers); Profile edits land here only.
 */
import { sql } from "drizzle-orm";
import type { BiographicalProfile, Database } from "@chronicle/db";

export async function updateBiographicalAnchor<K extends keyof BiographicalProfile>(
  db: Database,
  personId: string,
  key: K,
  value: BiographicalProfile[K],
): Promise<void> {
  await db.execute(sql`
    UPDATE persons
    SET biographical_anchors = COALESCE(biographical_anchors, '{}'::jsonb) || ${JSON.stringify({ [key]: value })}::jsonb,
        updated_at = now()
    WHERE id = ${personId}`);
}
