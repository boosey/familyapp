// @vitest-environment jsdom
/**
 * FollowUpButton (#77) hardening regressions:
 *   1. A REJECTED server action (network/unhandled server error) must not leave the form silently
 *      stuck — the catch surfaces the `failed` copy so the user can retry.
 *   2. When an error is shown, the textarea is associated with the message via aria-invalid +
 *      aria-describedby for screen readers.
 * The authorization/routing of the ask itself lives in packages/core; here we test the client shell.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { FollowUpButton } from "./FollowUpButton";

const askFollowUpAction = vi.fn();
vi.mock("./actions", () => ({
  askFollowUpAction: (fd: FormData) => askFollowUpAction(fd),
}));

afterEach(() => {
  cleanup();
  askFollowUpAction.mockReset();
});

function openForm() {
  render(<FollowUpButton storyId="s1" targetPersonId="p1" narratorName="Nana" />);
  fireEvent.click(screen.getByTestId("follow-up-open"));
}

it("surfaces the failed copy when the server action rejects (no silent stuck state)", async () => {
  askFollowUpAction.mockRejectedValueOnce(new Error("network"));
  openForm();

  const textarea = screen.getByPlaceholderText(hub.followUp.placeholder);
  fireEvent.change(textarea, { target: { value: "What happened next?" } });
  fireEvent.submit(screen.getByTestId("follow-up-form"));

  const err = await screen.findByTestId("follow-up-error");
  expect(err.textContent).toBe(hub.followUp.failed);
  // The form is still present (not swapped to the "sent" confirmation) so the user can retry.
  expect(screen.queryByTestId("follow-up-form")).not.toBeNull();
  expect(screen.queryByTestId("follow-up-sent")).toBeNull();
});

it("associates the error with the textarea via aria-invalid + aria-describedby", async () => {
  openForm();
  // Empty submit trips the client-side validation error, exercising the a11y wiring.
  fireEvent.submit(screen.getByTestId("follow-up-form"));

  const err = await screen.findByTestId("follow-up-error");
  expect(err.id).toBe("follow-up-error");
  const textarea = screen.getByPlaceholderText(hub.followUp.placeholder);
  expect(textarea.getAttribute("aria-invalid")).toBe("true");
  expect(textarea.getAttribute("aria-describedby")).toBe("follow-up-error");
});

it("clears aria wiring when there is no error", async () => {
  openForm();
  const textarea = screen.getByPlaceholderText(hub.followUp.placeholder);
  await waitFor(() => {
    expect(textarea.getAttribute("aria-invalid")).toBeNull();
    expect(textarea.getAttribute("aria-describedby")).toBeNull();
  });
});
