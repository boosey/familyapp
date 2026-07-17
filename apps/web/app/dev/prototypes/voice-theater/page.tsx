import { redirect } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { VoiceTheaterHub } from "./VoiceTheaterHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function VoiceTheaterPage() {
  if (!isDevSurfaceEnabled()) redirect("/");
  return <VoiceTheaterHub />;
}
