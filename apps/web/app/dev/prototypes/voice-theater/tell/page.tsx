import { redirect } from "next/navigation";
import { TellStage } from "./TellStage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function TellPage() {
  if (process.env.NODE_ENV === "production") redirect("/");
  return <TellStage />;
}
