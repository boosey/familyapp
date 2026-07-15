// @vitest-environment jsdom
/**
 * Behavior test for <FamilyDesignator> — the shared action-flow family picker (ADR-0021, #49).
 *
 * The load-bearing #49 guarantee is NO WRITE-BACK: changing the designator must NOT mutate the shared
 * `?families=` browse filter. FamilyDesignator imports NO next/navigation, so the strongest assertion
 * is that a mocked router `push` is never invoked after a change event (and that the select's value
 * updates so the send path carries the newly chosen family). We also assert the seed-from-filter
 * render: a seeded value selects that family with no placeholder; a null seed with >1 family shows the
 * disabled placeholder. next/navigation is mocked the same way family-chips.test.tsx does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FamilyDesignator } from "@/app/hub/FamilyDesignator";

// Even though the component imports NO next/navigation, mock it with a push spy so any accidental
// navigation would be observable — the no-write-back assertion checks it is never called.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
  { id: "fam-c", name: "Rossi" },
];

const baseProps = {
  name: "familyId",
  label: "Family",
  placeholder: "Choose a family…",
  requiredMessage: "Choose a family.",
};

describe("FamilyDesignator — no write-back (ADR-0021, #49)", () => {
  it("never calls the router when the selection changes", () => {
    render(<FamilyDesignator families={FAMILIES} seeded="fam-a" {...baseProps} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "fam-c" } });

    expect(push).not.toHaveBeenCalled();
    // The send path carries the newly chosen family.
    expect(select.value).toBe("fam-c");
  });
});

describe("FamilyDesignator — seed from filter", () => {
  it("selects the seeded family and renders no placeholder", () => {
    render(<FamilyDesignator families={FAMILIES} seeded="fam-b" {...baseProps} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("fam-b");
    expect(screen.queryByText("Choose a family…")).toBeNull();
  });

  it("renders a disabled placeholder when there is no seed and >1 family", () => {
    render(<FamilyDesignator families={FAMILIES} seeded={null} {...baseProps} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // Nothing is pre-selected — the disabled placeholder holds the empty value.
    expect(select.value).toBe("");
    const placeholder = screen.getByText("Choose a family…") as HTMLOptionElement;
    expect(placeholder.tagName).toBe("OPTION");
    expect(placeholder.disabled).toBe(true);
  });

  it("auto-selects the lone option (no placeholder) for a single-family viewer with a null seed", () => {
    render(<FamilyDesignator families={[FAMILIES[0]!]} seeded={null} {...baseProps} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("fam-a");
    expect(screen.queryByText("Choose a family…")).toBeNull();
  });
});
