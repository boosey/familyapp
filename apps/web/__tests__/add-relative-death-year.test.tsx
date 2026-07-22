// @vitest-environment jsdom
/**
 * Render test for the add-relative form's death-year field (spec §4): the optional "Year they died"
 * input appears ONLY when Life status = deceased, and is submitted on the typed MintPlacement
 * (#318). Mint goes through onMint — FormData is only used to collect HTML field values.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MintPlacement } from "@/app/hub/tree/placement";
import { AddRelativeForm } from "@/app/hub/tree/add-relative-form";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
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

it("submits the death year on typed MintPlacement when deceased", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  const { container } = render(<AddRelativeForm familyId="fam-1" onMint={onMint} />);

  fireEvent.change(screen.getByLabelText(hub.kin.lifeStatusFieldLabel), {
    target: { value: "deceased" },
  });
  fireEvent.change(screen.getByLabelText(hub.kin.deathYearFieldLabel), {
    target: { value: "1998" },
  });

  const form = container.querySelector("form")!;
  await act(async () => {
    fireEvent.submit(form);
  });

  expect(onMint).toHaveBeenCalledTimes(1);
  const placement = onMint.mock.calls[0]![0];
  expect(placement.kind).toBe("mint");
  expect(placement.deathYear).toBe(1998);
  expect(placement.lifeStatus).toBe("deceased");
});
