// @vitest-environment jsdom
/**
 * PhotoTagPanel (Phase B3) — the album viewer's tag-management surface (Subjects / People / Places /
 * Family). Seeded via `initial` so no server round-trip is needed. Verifies:
 *  1. All four labeled sections render.
 *  2. Adding an EXISTING subject calls tagPhotoSubjectAction with {personId}.
 *  3. Adding a NEW person calls it with {newPersonDisplayName} and chips the returned minted id.
 *  4. Adding a place (existing + new) calls tagPhotoPlaceAction with {placeId} / {newPlaceName}.
 *  5. Removing a chip calls the matching untag action.
 *  6. Toggling a family calls retargetPhotoFamiliesAction; removing the LAST family is blocked
 *     (shows lastFamilyLocked, no retarget call).
 *  7. A non-manager sees read-only chips and NO inputs.
 * Mocks next/navigation + the album actions module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PhotoTagPanel } from "@/app/hub/album/PhotoTagPanel";
import type { PhotoTagPanel as PhotoTagPanelData } from "@/app/hub/album/actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const tagPhotoSubjectAction = vi.fn(
  async (fd: FormData): Promise<{ personId: string } | { error: string }> =>
    fd.get("newPersonDisplayName")
      ? { personId: "minted-person" }
      : { personId: String(fd.get("personId")) },
);
const untagPhotoSubjectAction = vi.fn(
  async (_fd: FormData): Promise<{ ok: true }> => ({ ok: true }),
);
const tagPhotoPersonAction = vi.fn(
  async (_fd: FormData): Promise<{ personId: string }> => ({ personId: "minted-person-2" }),
);
const untagPhotoPersonAction = vi.fn(
  async (_fd: FormData): Promise<{ ok: true }> => ({ ok: true }),
);
const tagPhotoPlaceAction = vi.fn(
  async (fd: FormData): Promise<{ placeId: string }> =>
    fd.get("newPlaceName") ? { placeId: "minted-place" } : { placeId: String(fd.get("placeId")) },
);
const untagPhotoPlaceAction = vi.fn(
  async (_fd: FormData): Promise<{ ok: true }> => ({ ok: true }),
);
const retargetPhotoFamiliesAction = vi.fn(
  async (_fd: FormData): Promise<{ ok: true }> => ({ ok: true }),
);

vi.mock("@/app/hub/album/actions", () => ({
  loadPhotoTagPanelAction: vi.fn(),
  tagPhotoSubjectAction: (fd: FormData) => tagPhotoSubjectAction(fd),
  untagPhotoSubjectAction: (fd: FormData) => untagPhotoSubjectAction(fd),
  tagPhotoPersonAction: (fd: FormData) => tagPhotoPersonAction(fd),
  untagPhotoPersonAction: (fd: FormData) => untagPhotoPersonAction(fd),
  tagPhotoPlaceAction: (fd: FormData) => tagPhotoPlaceAction(fd),
  untagPhotoPlaceAction: (fd: FormData) => untagPhotoPlaceAction(fd),
  retargetPhotoFamiliesAction: (fd: FormData) => retargetPhotoFamiliesAction(fd),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const INITIAL = {
  detail: {
    id: "photo-1",
    caption: "At the lake",
    canManage: true,
    contributorDisplayName: "Ada",
    families: [
      { familyId: "fam-1", familyName: "The Lovelaces" },
      { familyId: "fam-2", familyName: "The Byrons" },
    ],
    subjects: [{ personId: "p-sub", displayName: "Grandpa Joe" }],
    people: [{ personId: "p-app", displayName: "Aunt May" }],
    places: [{ placeId: "pl-1", name: "Lake Como", familyId: "fam-1" }],
  },
  suggestions: {
    people: [
      { personId: "p-sub", displayName: "Grandpa Joe" },
      { personId: "p-app", displayName: "Aunt May" },
      { personId: "p-new", displayName: "Cousin Wren" },
    ],
    families: [
      { id: "fam-1", name: "The Lovelaces" },
      { id: "fam-2", name: "The Byrons" },
      { id: "fam-3", name: "The Shelleys" },
    ],
    places: [
      { placeId: "pl-1", name: "Lake Como" },
      { placeId: "pl-2", name: "Villa d'Este" },
    ],
  },
};

// The fixture omits AlbumPhotoDetailView audit fields the panel never reads; cast to the data type.
function clone(): PhotoTagPanelData {
  return JSON.parse(JSON.stringify(INITIAL)) as unknown as PhotoTagPanelData;
}

describe("PhotoTagPanel", () => {
  it("renders the four labeled sections", () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    expect(screen.getByText(/who this is about/i)).toBeTruthy();
    expect(screen.getByText(/who appears/i)).toBeTruthy();
    expect(screen.getByText(/^where$/i)).toBeTruthy();
    expect(screen.getByText("Which family albums")).toBeTruthy();
    expect(screen.getByRole("group", { name: /photo details/i })).toBeTruthy();
  });

  it("adds an EXISTING subject via tagPhotoSubjectAction with a personId", async () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    // The subjects field is the FIRST person field (People is second).
    const inputs = screen.getAllByPlaceholderText(/add a person/i);
    fireEvent.change(inputs[0]!, { target: { value: "Cousin" } });
    fireEvent.click(await screen.findByRole("option", { name: /cousin wren/i }));
    await vi.waitFor(() => expect(tagPhotoSubjectAction).toHaveBeenCalledTimes(1));
    const fd = tagPhotoSubjectAction.mock.calls[0]![0];
    expect(fd.get("personId")).toBe("p-new");
    expect(fd.get("newPersonDisplayName")).toBeNull();
  });

  it("adds a NEW person via newPersonDisplayName and chips the minted id", async () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    const inputs = screen.getAllByPlaceholderText(/add a person/i);
    fireEvent.change(inputs[0]!, { target: { value: "Brand New Person" } });
    fireEvent.keyDown(inputs[0]!, { key: "Enter" });
    await vi.waitFor(() => expect(tagPhotoSubjectAction).toHaveBeenCalledTimes(1));
    const fd = tagPhotoSubjectAction.mock.calls[0]![0];
    expect(fd.get("newPersonDisplayName")).toBe("Brand New Person");
    // The chip appears with the typed label; the minted id is reconciled behind it.
    expect(await screen.findByText("Brand New Person")).toBeTruthy();
    // Its remove button targets the minted id (no crash means it chipped).
    expect(screen.getByRole("button", { name: /remove brand new person/i })).toBeTruthy();
  });

  // Cold-review regression (B3): the two-phase optimistic add must not desync from the server.
  it("disables removal of a pending (in-flight) chip until its add resolves", async () => {
    let resolveAdd!: (v: { personId: string }) => void;
    tagPhotoSubjectAction.mockImplementationOnce(
      () => new Promise((r) => { resolveAdd = r; }),
    );
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    const inputs = screen.getAllByPlaceholderText(/add a person/i);
    fireEvent.change(inputs[0]!, { target: { value: "Pending Pat" } });
    fireEvent.keyDown(inputs[0]!, { key: "Enter" });
    // The optimistic chip appears; while the add is in flight its remove is DISABLED, and clicking
    // it fires NO untag (so an untag can never race ahead of its own tag and desync from the server).
    const removeBtn = (await screen.findByRole("button", {
      name: /remove pending pat/i,
    })) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
    fireEvent.click(removeBtn);
    expect(untagPhotoSubjectAction).not.toHaveBeenCalled();
    // Once the add resolves, the chip is confirmed and its remove becomes enabled.
    resolveAdd({ personId: "minted-late" });
    await vi.waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /remove pending pat/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("two rapid DIFFERENT new-name adds create two distinct chips (unique temp ids)", async () => {
    tagPhotoSubjectAction.mockImplementation(
      () => new Promise(() => {}) as Promise<{ personId: string }>,
    );
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    const input = screen.getAllByPlaceholderText(/add a person/i)[0]!;
    fireEvent.change(input, { target: { value: "Twin A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Twin B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Twin A")).toBeTruthy();
    expect(await screen.findByText("Twin B")).toBeTruthy();
    expect(tagPhotoSubjectAction).toHaveBeenCalledTimes(2);
  });

  it("blocks a duplicate identical new-name add while the first is still in flight", async () => {
    tagPhotoSubjectAction.mockImplementation(
      () => new Promise(() => {}) as Promise<{ personId: string }>,
    );
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    const input = screen.getAllByPlaceholderText(/add a person/i)[0]!;
    fireEvent.change(input, { target: { value: "Dup Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Dup Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Dup Name")).toBeTruthy();
    expect(tagPhotoSubjectAction).toHaveBeenCalledTimes(1);
  });

  it("adds an EXISTING place and a NEW place", async () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    const placeInput = screen.getByPlaceholderText(/add a place/i);
    fireEvent.change(placeInput, { target: { value: "Villa" } });
    fireEvent.click(await screen.findByRole("option", { name: /villa d'este/i }));
    await vi.waitFor(() => expect(tagPhotoPlaceAction).toHaveBeenCalledTimes(1));
    expect(tagPhotoPlaceAction.mock.calls[0]![0].get("placeId")).toBe("pl-2");

    fireEvent.change(placeInput, { target: { value: "New Beach" } });
    fireEvent.keyDown(placeInput, { key: "Enter" });
    await vi.waitFor(() => expect(tagPhotoPlaceAction).toHaveBeenCalledTimes(2));
    expect(tagPhotoPlaceAction.mock.calls[1]![0].get("newPlaceName")).toBe("New Beach");
  });

  it("removes a subject chip via untagPhotoSubjectAction", async () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    fireEvent.click(screen.getByRole("button", { name: /remove grandpa joe/i }));
    await vi.waitFor(() => expect(untagPhotoSubjectAction).toHaveBeenCalledTimes(1));
    expect(untagPhotoSubjectAction.mock.calls[0]![0].get("personId")).toBe("p-sub");
  });

  it("toggles a family via retargetPhotoFamiliesAction", async () => {
    render(<PhotoTagPanel photoId="photo-1" initial={clone()} />);
    // Add a third family (currently off).
    fireEvent.click(screen.getByRole("button", { name: /the shelleys/i }));
    await vi.waitFor(() => expect(retargetPhotoFamiliesAction).toHaveBeenCalledTimes(1));
    const fd = retargetPhotoFamiliesAction.mock.calls[0]![0];
    expect(fd.getAll("familyIds").sort()).toEqual(["fam-1", "fam-2", "fam-3"]);
  });

  it("blocks removing the LAST family: shows lastFamilyLocked and does NOT retarget", async () => {
    const one = clone();
    one.detail.families = [{ familyId: "fam-1", familyName: "The Lovelaces" }];
    render(<PhotoTagPanel photoId="photo-1" initial={one} />);
    // Turn off the only ON family.
    fireEvent.click(screen.getByRole("button", { name: /the lovelaces/i }));
    expect(retargetPhotoFamiliesAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/at least one family album/i);
  });

  it("a non-manager sees read-only chips and NO inputs", () => {
    const ro = clone();
    ro.detail.canManage = false;
    render(<PhotoTagPanel photoId="photo-1" initial={ro} />);
    // Chips still render (tags viewable).
    expect(screen.getByText("Grandpa Joe")).toBeTruthy();
    expect(screen.getByText("Lake Como")).toBeTruthy();
    // No typeahead inputs, no remove buttons, no interactive family placement chips.
    expect(screen.queryByPlaceholderText(/add a person/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/add a place/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /remove grandpa joe/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /the lovelaces/i })).toBeNull();
    // The placement families show as static text.
    const placement = screen.getByText("Which family albums").parentElement as HTMLElement;
    expect(within(placement).getByText("The Lovelaces")).toBeTruthy();
  });
});
