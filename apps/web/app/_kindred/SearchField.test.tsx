// @vitest-environment jsdom
/**
 * SearchField — the ONE reusable search input (Stories browse + Album filter). Pins: it's a native
 * search box (role "searchbox"), wears the shared `.field` class (sized to the ActionButton height),
 * carries its aria-label + placeholder, and reports raw string changes to `onChange`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchField } from "./SearchField";
import s from "./SearchField.module.css";

afterEach(cleanup);

describe("SearchField", () => {
  it("renders a searchbox with the shared field class, aria-label, and placeholder", () => {
    render(<SearchField value="" onChange={() => {}} ariaLabel="Search stories" placeholder="Search…" />);
    const box = screen.getByRole("searchbox", { name: "Search stories" });
    expect(box.className).toContain(s.field);
    expect(box.getAttribute("placeholder")).toBe("Search…");
  });

  it("reports the raw next string to onChange", () => {
    const onChange = vi.fn();
    render(<SearchField value="" onChange={onChange} ariaLabel="Search" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "storm" } });
    expect(onChange).toHaveBeenCalledWith("storm");
  });

  it("is a controlled input (reflects `value`)", () => {
    render(<SearchField value="nonna" onChange={() => {}} ariaLabel="Search" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("nonna");
  });
});
