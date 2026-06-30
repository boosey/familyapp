"use client";

/**
 * ClerkSignOutItem — the ONLY place @clerk/nextjs is imported on the client.
 *
 * This file must never be imported with a static `import` statement. It is loaded
 * exclusively via `next/dynamic` in KindredAccountMenu so that the @clerk/nextjs
 * chunk is code-split and never fetched in mock/dev mode (where ClerkProvider is
 * absent and useClerk() would throw).
 */
import { useClerk } from "@clerk/nextjs";
import type { CSSProperties } from "react";

interface ClerkSignOutItemProps {
  label: string;
  style: CSSProperties;
  onClose: () => void;
}

export function ClerkSignOutItem({ label, style, onClose }: ClerkSignOutItemProps) {
  const { signOut } = useClerk();

  return (
    <button
      type="button"
      role="menuitem"
      style={style}
      onClick={() => {
        onClose();
        void signOut({ redirectUrl: "/" });
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-sunken)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}
