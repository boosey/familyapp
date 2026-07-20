// @vitest-environment jsdom
/**
 * StoryDateEditor (ADR-0026 #241) client shell: the trigger opens the modal, the form maps each
 * of the three forms (+ undated) onto the action's FormData contract (a circa year is padded to
 * the year-aligned point), the live preview uses the same formatStoryDate smart display as the
 * read paths, client-side validation blocks bad input before the action fires, and a rejected
 * action surfaces a retry-able error. Ownership, validation, and persistence live in
 * packages/core (story-mgmt-core.test.ts); here we test the client shell.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { StoryDateEditor, type StoryDateValue } from "./StoryDateEditor";

const editStoryDateAction = vi.fn();
vi.mock("./actions", () => ({
  editStoryDateAction: (fd: FormData) => editStoryDateAction(fd),
}));

afterEach(() => {
  cleanup();
  editStoryDateAction.mockReset();
});

function openModal(current: StoryDateValue | null = null) {
  render(<StoryDateEditor storyId="s1" current={current} />);
  fireEvent.click(screen.getByTestId("story-date-edit"));
}

function submittedFormData(): FormData {
  expect(editStoryDateAction).toHaveBeenCalledTimes(1);
  return editStoryDateAction.mock.calls[0]![0] as FormData;
}

it("submits an exact date and closes on success", async () => {
  editStoryDateAction.mockResolvedValueOnce(undefined);
  openModal();

  fireEvent.click(screen.getByLabelText(hub.storyDate.kindDate));
  fireEvent.change(screen.getByTestId("story-date-input"), { target: { value: "1943-12-25" } });
  fireEvent.submit(screen.getByTestId("story-date-form"));

  const fd = submittedFormData();
  expect(fd.get("storyId")).toBe("s1");
  expect(fd.get("occurredKind")).toBe("date");
  expect(fd.get("occurredDate")).toBe("1943-12-25");
  expect(fd.get("occurredEndDate")).toBeNull();
  // The modal closed (the form is gone) once the action resolved without an error.
  expect(await screen.findByTestId("story-date-edit")).toBeTruthy();
  expect(screen.queryByTestId("story-date-form")).toBeNull();
});

it("submits a period with both ends, seeded from the current value", () => {
  editStoryDateAction.mockResolvedValueOnce(undefined);
  openModal({ kind: "period", date: "1951-09-01", endDate: "1955-06-30" });

  // The form is seeded from the saved value: the period radio is checked and both ends carry.
  expect(screen.getByLabelText(hub.storyDate.kindPeriod)).toHaveProperty("checked", true);
  expect(screen.getByTestId("story-period-start")).toHaveProperty("value", "1951-09-01");
  expect(screen.getByTestId("story-period-end")).toHaveProperty("value", "1955-06-30");

  fireEvent.submit(screen.getByTestId("story-date-form"));
  const fd = submittedFormData();
  expect(fd.get("occurredKind")).toBe("period");
  expect(fd.get("occurredDate")).toBe("1951-09-01");
  expect(fd.get("occurredEndDate")).toBe("1955-06-30");
});

it("pads a circa year to the year-aligned point and previews with the smart display", () => {
  editStoryDateAction.mockResolvedValueOnce(undefined);
  openModal();

  fireEvent.click(screen.getByLabelText(hub.storyDate.kindCirca));
  fireEvent.change(screen.getByTestId("story-circa-input"), { target: { value: "1949" } });

  // The live preview uses the same formatStoryDate smart display as the rest of the app.
  expect(screen.getByTestId("story-date-preview").textContent).toBe(
    hub.storyDate.preview("c. 1949"),
  );

  fireEvent.submit(screen.getByTestId("story-date-form"));
  const fd = submittedFormData();
  expect(fd.get("occurredKind")).toBe("circa");
  expect(fd.get("occurredDate")).toBe("1949-01-01");
});

it("marks the story undated (default for an undated story, no date fields sent)", () => {
  editStoryDateAction.mockResolvedValueOnce(undefined);
  openModal();

  // An undated story opens on the undated choice already.
  expect(screen.getByLabelText(hub.storyDate.kindUndated)).toHaveProperty("checked", true);
  expect(screen.getByTestId("story-date-preview").textContent).toBe(
    hub.storyDate.preview(hub.browse.undated),
  );

  fireEvent.submit(screen.getByTestId("story-date-form"));
  const fd = submittedFormData();
  expect(fd.get("occurredKind")).toBe("undated");
  expect(fd.get("occurredDate")).toBeNull();
  expect(fd.get("occurredEndDate")).toBeNull();
});

it("blocks an inverted period client-side without calling the action", () => {
  openModal();

  fireEvent.click(screen.getByLabelText(hub.storyDate.kindPeriod));
  fireEvent.change(screen.getByTestId("story-period-start"), { target: { value: "1955-06-30" } });
  fireEvent.change(screen.getByTestId("story-period-end"), { target: { value: "1951-09-01" } });
  fireEvent.submit(screen.getByTestId("story-date-form"));

  expect(editStoryDateAction).not.toHaveBeenCalled();
  expect(screen.getByTestId("story-date-error").textContent).toBe(hub.storyDate.invalidPeriod);
  // The form stays open so the person can fix the input.
  expect(screen.queryByTestId("story-date-form")).not.toBeNull();
});

it("surfaces a retry-able error when the server action rejects (no silent stuck state)", async () => {
  editStoryDateAction.mockRejectedValueOnce(new Error("network"));
  openModal();

  fireEvent.click(screen.getByLabelText(hub.storyDate.kindDate));
  fireEvent.change(screen.getByTestId("story-date-input"), { target: { value: "1943-12-25" } });
  fireEvent.submit(screen.getByTestId("story-date-form"));

  const err = await screen.findByTestId("story-date-error");
  expect(err.textContent).toBe(hub.storyDetail.genericError);
  expect(err.getAttribute("role")).toBe("alert");
  expect(screen.queryByTestId("story-date-form")).not.toBeNull();
});
