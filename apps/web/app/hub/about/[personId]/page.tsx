/**
 * /hub/about/[personId] — LEGACY alias (tree Slice B).
 *
 * The "Stories about X" (issue #35) content folded into the unified per-person page's **Mentions**
 * tab (`/hub/person/[personId]?section=mentions`). This route is kept only so existing deep links
 * (e.g. a story-detail byline or an older shared URL) don't 404 — it permanently redirects there.
 * `listStoriesAboutPerson` + the Mentions rendering now live in `/hub/person/[personId]`.
 */
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StoriesAboutPersonRedirect({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  redirect(`/hub/person/${personId}?section=mentions`);
}
