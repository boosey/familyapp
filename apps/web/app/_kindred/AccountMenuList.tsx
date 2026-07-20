"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import type { AccountMenuItem } from "./KindredAccountMenu";

/**
 * The account menu's ITEM LIST — the profile/settings/switch-user/(family settings)/log-out rows,
 * shared by BOTH presentations so their item wiring (hrefs, onSelect, the Clerk sign-out row) can't
 * drift: the desktop {@link KindredAccountMenu} dropdown and the mobile bottom-bar {@link AccountSheet}.
 *
 * Each item is a `role="menuitem"`: an <a> for `href` items, a <button> for `onSelect` items. The
 * log-out row is swapped for the dynamically-imported ClerkSignOutItem when `clerkSignOut` is set (so
 * @clerk/nextjs is only fetched when ClerkProvider is mounted). `onClose` is called after any selection.
 */
const ClerkSignOutItemDynamic = dynamic(
  () => import("./ClerkSignOutItem").then((m) => ({ default: m.ClerkSignOutItem })),
  { ssr: false },
);

export function AccountMenuList({
  items,
  itemStyle,
  clerkSignOut,
  onClose,
}: {
  items: AccountMenuItem[];
  itemStyle: CSSProperties;
  clerkSignOut: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (clerkSignOut && item.key === "log-out") {
          return (
            <ClerkSignOutItemDynamic
              key={item.key}
              label={item.label}
              style={itemStyle}
              onClose={onClose}
            />
          );
        }

        const content = (
          <>
            {item.icon && (
              <span
                aria-hidden="true"
                style={{ fontSize: "1rem", lineHeight: 1, width: 18, textAlign: "center" }}
              >
                {item.icon}
              </span>
            )}
            {item.label}
          </>
        );

        if (item.href) {
          return (
            <a
              key={item.key}
              href={item.href}
              role="menuitem"
              style={itemStyle}
              onClick={onClose}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-sunken)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
              }}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            style={itemStyle}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {content}
          </button>
        );
      })}
    </>
  );
}
