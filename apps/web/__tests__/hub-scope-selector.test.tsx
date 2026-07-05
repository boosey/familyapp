// @vitest-environment jsdom
/**
 * Behavior test for <HubScopeSelector> — the hub header `[ All ▾ ]` scope pill.
 *
 * Asserts: the trigger shows the current scope label; opening lists All + each active family; a
 * family row navigates to `/hub?tab=<tab>&scope=<familyId>` preserving the tab; muted pending rows
 * render only when there are pending requests; the Create/Find actions are always pinned; and the
 * empty-family case shows the "No family yet" label. `useRouter` is mocked so we can assert the
 * navigation target without a real router.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HubScopeSelector } from "@/app/hub/HubScopeSelector";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const FAMILIES = [
  { familyId: "fam-esposito", familyName: "Esposito" },
  { familyId: "fam-marino", familyName: "Marino" },
];

describe("HubScopeSelector", () => {
  it("shows the current scope label on the trigger and lists All + families when opened", () => {
    render(<HubScopeSelector scope="all" tab="stories" families={FAMILIES} pending={[]} />);
    // Trigger reflects the current scope.
    const trigger = screen.getByRole("button", { name: "Choose which family to view" });
    expect(trigger.textContent).toContain("All");

    fireEvent.click(trigger);
    // The open menu lists All + each family as a scope row.
    expect(screen.getByRole("menuitemradio", { name: /All/ })).toBeTruthy();
    expect(screen.getByText("Esposito")).toBeTruthy();
    expect(screen.getByText("Marino")).toBeTruthy();
    // Create/Find actions are always pinned.
    expect(screen.getByText("+ Create a family")).toBeTruthy();
    expect(screen.getByText("🔍 Find a family to join")).toBeTruthy();
  });

  it("navigates to the tab-preserving scope url when a family row is clicked", () => {
    render(<HubScopeSelector scope="all" tab="questions" families={FAMILIES} pending={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose which family to view" }));
    fireEvent.click(screen.getByText("Marino"));
    expect(push).toHaveBeenCalledWith("/hub?tab=questions&scope=fam-marino");
  });

  it("marks the active family scope as checked", () => {
    render(<HubScopeSelector scope="fam-marino" tab="stories" families={FAMILIES} pending={[]} />);
    const trigger = screen.getByRole("button", { name: "Choose which family to view" });
    expect(trigger.textContent).toContain("Marino");
    fireEvent.click(trigger);
    const marinoRow = screen.getByRole("menuitemradio", { name: /Marino/ });
    expect(marinoRow.getAttribute("aria-checked")).toBe("true");
  });

  it("renders no pending rows when there are no pending requests", () => {
    render(<HubScopeSelector scope="all" tab="stories" families={FAMILIES} pending={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose which family to view" }));
    expect(screen.queryByText(/Pending/)).toBeNull();
  });

  it("renders muted pending rows when there are pending requests", () => {
    render(
      <HubScopeSelector
        scope="all"
        tab="stories"
        families={FAMILIES}
        pending={[{ familyName: "Rossi", stewardName: "Gina Rossi" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose which family to view" }));
    expect(screen.getByText(/Rossi — Pending/)).toBeTruthy();
  });

  it("shows 'No family yet' when a non-'all' scope has no matching active family", () => {
    render(<HubScopeSelector scope="fam-gone" tab="stories" families={[]} pending={[]} />);
    const trigger = screen.getByRole("button", { name: "Choose which family to view" });
    expect(trigger.textContent).toContain("No family yet");
  });
});
