import { redirect } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { SundayLetterHub } from "./SundayLetterHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SundayLetterPage() {
  if (!isDevSurfaceEnabled()) redirect("/");
  return <SundayLetterHub />;
}
