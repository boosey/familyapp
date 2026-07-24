// @vitest-environment jsdom
/**
 * Account › Memories — MemoriesList (ADR-0029 §#357, design-out changes #8/#9/#10). Covers the
 * densified row's edit→save / edit→cancel / forget flows (markup changed, save/rollback logic did
 * not), and the stub "Add a memory" create-form surfacing its not-yet-available error gracefully.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoriesList } from "./MemoriesList";
import type { MemoryItem } from "./view-model";
import {
  saveTextMemoryAction,
  forgetMemoryAction,
  createCustomMemoryAction,
} from "./actions";

vi.mock("./actions", () => ({
  saveTextMemoryAction: vi.fn(async () => ({ ok: true })),
  saveBoolMemoryAction: vi.fn(async () => ({ ok: true })),
  forgetMemoryAction: vi.fn(async () => ({ ok: true })),
  createCustomMemoryAction: vi.fn(async () => ({ error: "not_yet_available" })),
}));

const saveTextMock = vi.mocked(saveTextMemoryAction);
const forgetMock = vi.mocked(forgetMemoryAction);
const createMock = vi.mocked(createCustomMemoryAction);

const hometown: MemoryItem = {
  id: "hometown",
  key: "hometown",
  title: "Where you're from",
  summary: "New Orleans",
  origin: "user",
  sourceStoryId: null,
  tags: [],
  isSet: true,
  kind: "text",
  rawText: "New Orleans",
  rawBool: null,
  placeholder: "e.g. New Orleans, Louisiana",
};

afterEach(() => {
  cleanup();
  saveTextMock.mockClear();
  forgetMock.mockClear();
  createMock.mockClear();
});

describe("MemoriesList — row edit/forget", () => {
  it("edit → save: writes the new value and exits edit mode", async () => {
    render(<MemoriesList items={[hometown]} title="What we remember" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText(hometown.placeholder) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Austin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(saveTextMock).toHaveBeenCalledWith("hometown", "Austin");
      expect(screen.getByText("Austin")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText(hometown.placeholder)).toBeNull();
  });

  it("edit → cancel: discards the draft without saving", () => {
    render(<MemoriesList items={[hometown]} title="What we remember" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText(hometown.placeholder) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Austin" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(saveTextMock).not.toHaveBeenCalled();
    expect(screen.getByText("New Orleans")).toBeTruthy();
  });

  it("forget: clears the value via forgetMemoryAction", async () => {
    render(<MemoriesList items={[hometown]} title="What we remember" />);
    fireEvent.click(screen.getByRole("button", { name: "Forget this" }));
    await vi.waitFor(() => {
      expect(forgetMock).toHaveBeenCalledWith("hometown");
      expect(screen.getByText("Not set")).toBeTruthy();
    });
  });
});

describe("MemoriesList — add-a-memory stub", () => {
  it("opens the create form, and surfaces the stub's not-available error without throwing", async () => {
    render(<MemoriesList items={[hometown]} title="What we remember" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a memory" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. My favorite recipe"), {
      target: { value: "Grandma's pie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith("Grandma's pie", "");
      expect(
        screen.getByText(/adding memories isn't available yet/i),
      ).toBeTruthy();
    });
  });
});
