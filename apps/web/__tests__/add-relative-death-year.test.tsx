// @vitest-environment jsdom
/**
 * Render test for the add-relative form's death-year field (spec §4): the optional "Year they died"
 * input appears ONLY when Life status = deceased, and is submitted in the FormData. The server action
 * is mocked so this stays a pure client-form test (no server-only deps).
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { addRelativeAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
}));
vi.mock("../app/hub/kin/actions", () => ({ addRelativeAction }));

import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
});

it("shows the death-year field only when the relative is deceased", () => {
  render(<AddRelativeForm familyId="fam-1" />);

  // Hidden while living (the default).
  expect(screen.queryByLabelText(hub.kin.deathYearFieldLabel)).toBeNull();

  // Flip life status to deceased → the field appears.
  const lifeStatus = screen.getByLabelText(hub.kin.lifeStatusFieldLabel);
  fireEvent.change(lifeStatus, { target: { value: "deceased" } });
  const deathYear = screen.getByLabelText(hub.kin.deathYearFieldLabel);
  expect(deathYear).toBeTruthy();
  expect((deathYear as HTMLInputElement).name).toBe("deathYear");

  // And disappears again when set back to living.
  fireEvent.change(lifeStatus, { target: { value: "living" } });
  expect(screen.queryByLabelText(hub.kin.deathYearFieldLabel)).toBeNull();
});

it("submits the death year in FormData when deceased", () => {
  const { container } = render(<AddRelativeForm familyId="fam-1" />);

  fireEvent.change(screen.getByLabelText(hub.kin.lifeStatusFieldLabel), {
    target: { value: "deceased" },
  });
  fireEvent.change(screen.getByLabelText(hub.kin.deathYearFieldLabel), {
    target: { value: "1998" },
  });

  const form = container.querySelector("form")!;
  fireEvent.submit(form);

  expect(addRelativeAction).toHaveBeenCalledTimes(1);
  const fd = addRelativeAction.mock.calls[0]![0];
  expect(fd.get("deathYear")).toBe("1998");
  expect(fd.get("lifeStatus")).toBe("deceased");
});
