import { redirect } from "next/navigation";

export default function AskPage() {
  redirect("/hub?tab=ask");
}
