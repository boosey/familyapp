"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget: once the invite link has rendered, clear its flash cookie server-side so a
 * refresh won't show it again. Mutating the cookie can't happen during render (Next 15), so we do
 * it from a Route Handler triggered here on mount.
 */
export function ClearInviteFlash() {
  useEffect(() => {
    void fetch("/api/hub/clear-invite-flash", { method: "POST" });
  }, []);
  return null;
}
