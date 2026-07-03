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
  async (..._args: unknown[]): Promise<{ ok: true; photoId: string }> => ({
    ok: true,
    photoId: "photo-1",
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
