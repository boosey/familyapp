/**
 * /hub/account/[section] — the Account surface's section panel (ADR-0029). Resolves the viewer /
 * personId + db EXACTLY as /hub/profile/page.tsx does, looks up the section in the FROZEN registry
 * (`account-sections.ts`) by `params.section`, 404s an unknown slug, and renders its Component with
 * `AccountSectionProps`. The left rail / drill-down chrome lives in the sibling `layout.tsx`.
 */
import { redirect, notFound } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { findAccountSection } from "../account-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const entry = findAccountSection(section);
  if (!entry) notFound();

  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest === "/welcome") redirect(dest);

  const { Component } = entry;
  return <Component personId={ctx.personId} db={db} viewer={ctx} />;
}
