"use server";

import { redirect } from "next/navigation";
import { mockSignOut } from "@/lib/auth-mock";

/**
 * Shared sign-out server action for the account menu.
 *
 * In mock/dev mode this clears the session cookie and returns to the landing. In Clerk mode the
 * menu swaps the log-out row for ClerkSignOutItem (client `useClerk().signOut`) and this action is
 * never invoked — `mockSignOut` is a harmless cookie delete either way, so importing it in both
 * modes is safe.
 */
export async function logOut(): Promise<void> {
  await mockSignOut();
  redirect("/");
}
