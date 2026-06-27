import { redirect } from "next/navigation";

export default function InviteResultPage() {
  redirect("/hub?tab=invite");
}
