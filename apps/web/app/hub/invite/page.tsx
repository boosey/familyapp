import { redirect } from "next/navigation";

export default function InvitePage() {
  redirect("/hub?tab=invite");
}
