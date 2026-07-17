import { redirect } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { TellStage } from "./TellStage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function TellPage() {
  if (!isDevSurfaceEnabled()) redirect("/");
  return <TellStage />;
}
