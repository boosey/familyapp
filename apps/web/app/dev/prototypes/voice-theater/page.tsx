import { redirect } from "next/navigation";
import { VoiceTheaterHub } from "./VoiceTheaterHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function VoiceTheaterPage() {
  if (process.env.NODE_ENV === "production") redirect("/");
  return <VoiceTheaterHub />;
}
