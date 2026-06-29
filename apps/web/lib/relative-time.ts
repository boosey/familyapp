// apps/web/lib/relative-time.ts
// Short relative-date label shared by the Questions tab and the Answer flow.
// "just now" (<2 min) → "N min ago" (<60 min) → "Nh ago" (<24h) → "Mon D".
// Safe in both server and client components — `common` is a plain copy object.
import { common } from "@/app/_copy";

export function relativeShortDate(value: string | Date): string {
  const d = new Date(value);
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMins < 2) return common.relativeTime.justNow;
  if (diffMins < 60) return common.relativeTime.minsAgo(diffMins);
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return common.relativeTime.hrsAgo(diffHrs);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
