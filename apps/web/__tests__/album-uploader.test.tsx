// @vitest-environment jsdom
/**
 * AlbumUploader — the multi-family placement picker (#16).
 *  1. In >=2 families: one checkbox per family; ONLY the current-context family is checked by
 *     default (the default is the album on screen, never "all").
 *  2. Solo (one family): no checkboxes render — the server defaults to the sole family.
 *  3. Deselecting the last checked album disables the submit button (>=1 must stay selected).
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlbumUploader } from "@/app/hub/album/AlbumUploader";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const uploadAlbumPhotoAction = vi.fn(
  async (..._args: unknown[]): Promise<{ ok: true; added: number; failed: number }> => ({
    ok: true,
    added: 1,
    failed: 0,
  }),
);
vi.mock("@/app/hub/album/actions", () => ({
  uploadAlbumPhotoAction: (...args: unknown[]) => uploadAlbumPhotoAction(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FAM_A = { familyId: "aaaaaaaa-0000-0000-0000-000000000000", familyName: "Esposito" };
const FAM_B = { familyId: "bbbbbbbb-0000-0000-0000-000000000000", familyName: "Marino" };

describe("AlbumUploader multi-family picker", () => {
  it("checks ONLY the current-context family by default (not all)", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    const a = screen.getByLabelText(FAM_A.familyName) as HTMLInputElement;
    const b = screen.getByLabelText(FAM_B.familyName) as HTMLInputElement;
    expect(b.checked).toBe(true);
    expect(a.checked).toBe(false);
  });

  it("renders NO checkboxes for a solo-family contributor", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("disables submit when the only checked album is deselected", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    const submit = screen.getByRole("button", { name: /add to album/i }) as HTMLButtonElement;
    // With a file chosen and the current album checked, submit is enabled...
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(submit.disabled).toBe(false);
    // ...deselecting the sole checked album disables it (>=1 must stay selected).
    const a = screen.getByLabelText(FAM_A.familyName) as HTMLInputElement;
    fireEvent.click(a);
    expect(submit.disabled).toBe(true);
  });

  // #16 multi-select: the file input carries `multiple` so the OS picker allows many files.
  it("marks the file input as multiple (OS multi-select picker)", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);
  });

  // #16 multi-select: selecting several files and submitting sends ALL of them to the action as
  // repeated `photo` FormData entries (each becomes its own album photo, same chosen album[s]).
  it("submits every selected file as a separate `photo` entry", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1, 2, 3])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([4, 5, 6])], "p2.png", { type: "image/png" });
    const f3 = new File([new Uint8Array([7, 8, 9])], "p3.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2, f3] } });

    // Submit the form directly (jsdom does not synthesize a submit event from a button click).
    fireEvent.submit(fileInput.closest("form")!);

    await vi.waitFor(() => expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1));
    const formData = uploadAlbumPhotoAction.mock.calls[0]![0] as FormData;
    const photos = formData.getAll("photo");
    expect(photos).toHaveLength(3);
    expect((photos[0] as File).name).toBe("p1.png");
    expect((photos[2] as File).name).toBe("p3.png");
  });

  // A partial-success batch (some files failed) surfaces a gentle status note, NOT an error alert.
  it("shows a soft note (not an error) after a partial-success batch", async () => {
    uploadAlbumPhotoAction.mockResolvedValueOnce({ ok: true, added: 2, failed: 1 });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });
    fireEvent.submit(fileInput.closest("form")!);

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/couldn't be added/i),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Regression (review finding): the action can REJECT (e.g. the request body exceeds the Server
  // Action / platform size limit) rather than return an { error } shape. That rejection must surface a
  // clear message, not be swallowed by the transition so the upload silently does nothing.
  it("surfaces an error when the upload action throws (does not fail silently)", async () => {
    uploadAlbumPhotoAction.mockRejectedValueOnce(new Error("Body exceeded 1 MB limit"));
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });
    fireEvent.submit(fileInput.closest("form")!);

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/too large/i),
    );
    expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1);
  });

  // Regression (review finding): a batch over the per-batch cap is rejected client-side with a
  // friendly message and never spends an upload (the server enforces the same cap authoritatively).
  it("rejects an over-cap batch client-side without calling the action", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const tooMany = Array.from(
      { length: 31 },
      (_, i) => new File([new Uint8Array([i])], `p${i}.png`, { type: "image/png" }),
    );
    fireEvent.change(fileInput, { target: { files: tooMany } });
    fireEvent.submit(fileInput.closest("form")!);

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/too many/i),
    );
    expect(uploadAlbumPhotoAction).not.toHaveBeenCalled();
  });

  // Regression: the family switcher is a same-route soft navigation, so this client component is
  // NOT remounted — only `currentFamilyId` changes. The picker default must follow the new context
  // (default = the album on screen), not stay stuck on the family it first mounted with.
  it("re-defaults the picker to the new current family when currentFamilyId changes (no remount)", () => {
    const { rerender } = render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(false);

    // Same component instance, new context family (mirrors the switcher's prop-only change).
    rerender(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(false);
  });
});
