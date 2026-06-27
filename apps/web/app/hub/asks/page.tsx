import { redirect } from "next/navigation";

export default function AsksPage() {
  redirect("/hub?tab=asks");
}
