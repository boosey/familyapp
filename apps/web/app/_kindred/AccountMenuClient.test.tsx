// @vitest-environment jsdom
/**
 * ADR-0025 device round (#233) — <AccountMenuClient> gates the account presentation by viewport:
 *  - desktop (useIsCompact === false, the server + first-paint contract) → the fixed top-right avatar +
 *    dropdown (KindredAccountMenu), exactly as before;
 *  - phone (true) → NOTHING (the bottom nav bar owns the account entry, so there's no duplicate).
 * useIsCompact is mocked (mirroring hub-primary-nav.test.tsx) to drive each branch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountMenuClient } from "./AccountMenuClient";
import { hub } from "@/app/_copy";
import { common } from "@/app/_copy";

let compact = false;
vi.mock("./useIsCompact", () => ({ useIsCompact: () => compact }));

const items = [
  { key: "profile", label: hub.shell.menuProfile, href: "/hub/profile" },
  { key: "log-out", label: hub.shell.menuLogOut, onSelect: () => {} },
];

afterEach(() => {
  cleanup();
  compact = false;
});

describe("AccountMenuClient viewport branch", () => {
  it("renders the fixed avatar trigger on desktop", () => {
    compact = false;
    render(<AccountMenuClient initials="AL" viewerName="Ada Lovelace" items={items} clerkSignOut={false} />);
    // The avatar button (its accessible name is common.account.yourAccount) is present.
    expect(screen.getByRole("button", { name: common.account.yourAccount })).toBeTruthy();
  });

  it("renders NOTHING on a phone (the bottom bar owns the account entry)", () => {
    compact = true;
    const { container } = render(
      <AccountMenuClient initials="AL" viewerName="Ada Lovelace" items={items} clerkSignOut={false} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button", { name: common.account.yourAccount })).toBeNull();
  });
});
