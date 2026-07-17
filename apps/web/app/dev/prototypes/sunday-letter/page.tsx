import { redirect } from "next/navigation";
import { SundayLetterHub } from "./SundayLetterHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SundayLetterPage() {
  if (process.env.NODE_ENV === "production") redirect("/");
  return <SundayLetterHub />;
}
