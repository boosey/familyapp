// @vitest-environment jsdom
/**
 * PhotoActionBar — the shared per-photo action set used BOTH as the compact hover toolbar on a grid
 * thumbnail and as the full labeled row in the viewer. The load-bearing behavior under test is the
 * two-tap delete confirm AND — critically — its RESET path: because the compact toolbar stays mounted
 * and is merely CSS-hidden on pointer/focus leave, an armed-but-abandoned confirm must disarm on
 * mouse-leave / focus-out, or a later single click would delete with no fresh confirm (cold-review
 * blocking finding, 2026-07-13). Also covers the `onTagPeople` placeholder branch.
 * Mocks next/navigation (Ask/Tell are router.push deep-links).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhotoActionBar } from "@/app/hub/album/PhotoActionBar";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PHOTO = { id: "photo-1", caption: null, canManage: true };

describe("PhotoActionBar", () => {
  it("two-tap delete: first tap arms, second tap calls onDelete", () => {
    const onDelete = vi.fn();
    render(
      <PhotoActionBar photo={PHOTO} variant="full" onEdit={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    // Now armed — the label flips to the confirm copy.
    const armed = screen.getByRole("button", { name: /tap again to remove/i });
    fireEvent.click(armed);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("disarms an abandoned confirm on mouse-leave (no stranded one-click delete)", () => {
    const onDelete = vi.fn();
    render(
      <PhotoActionBar photo={PHOTO} variant="compact" onEdit={vi.fn()} onDelete={onDelete} />,
    );
    // Arm it, then move the pointer away (the compact toolbar hides but stays mounted).
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /tap again to remove/i })).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole("group"));
    // Back to the un-armed label; a single subsequent click must only RE-ARM, not delete.
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disarms when focus leaves the group entirely", () => {
    const onDelete = vi.fn();
    render(
      <div>
        <PhotoActionBar photo={PHOTO} variant="full" onEdit={vi.fn()} onDelete={onDelete} />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /tap again to remove/i })).toBeTruthy();
    // Focus moves to a control OUTSIDE the group → disarm.
    fireEvent.blur(screen.getByRole("group"), {
      relatedTarget: screen.getByRole("button", { name: /outside/i }),
    });
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("keeps the confirm armed while focus moves BETWEEN the group's own buttons", () => {
    render(
      <PhotoActionBar photo={PHOTO} variant="full" onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const del = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(del);
    // Blur whose relatedTarget is still inside the group (another action) must NOT disarm.
    fireEvent.blur(screen.getByRole("group"), {
      relatedTarget: screen.getByRole("button", { name: /^ask$/i }),
    });
    expect(screen.getByRole("button", { name: /tap again to remove/i })).toBeTruthy();
  });

  it("renders Tag people as a disabled placeholder when no handler is given, enabled when wired", () => {
    const { rerender } = render(
      <PhotoActionBar photo={PHOTO} variant="full" onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(
      (screen.getByRole("button", { name: /tag people/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const onTagPeople = vi.fn();
    rerender(
      <PhotoActionBar
        photo={PHOTO}
        variant="full"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTagPeople={onTagPeople}
      />,
    );
    const btn = screen.getByRole("button", { name: /tag people/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onTagPeople).toHaveBeenCalledTimes(1);
  });

  it("Ask and Tell deep-link via the router", () => {
    render(
      <PhotoActionBar photo={PHOTO} variant="full" onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("tab=ask"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("subjectPhotoIds=photo-1"));
    fireEvent.click(screen.getByRole("button", { name: /tell a story/i }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/hub/tell?subjectPhotoId=photo-1"));
  });

  it("hides manage-only controls for a non-manager but keeps Ask/Tell", () => {
    render(
      <PhotoActionBar
        photo={{ id: "p", caption: null, canManage: false }}
        variant="full"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /tag people/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeTruthy();
  });
});
