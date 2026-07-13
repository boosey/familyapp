// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { TagInput } from "@/app/hub/TagInput";
import type { TagSuggestions, TagToken } from "@/app/hub/tag-input-types";

const suggestions: TagSuggestions = {
  people: [{ personId: "p1", displayName: "Grandma Rose" }],
  families: [{ id: "f1", name: "The Boudreaux Family" }],
  tags: ["Vacation"],
};

afterEach(cleanup);

it("Enter with no dropdown match adds a freeform TEXT token", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  const input = getByPlaceholderText(/add a tag or name/i);
  fireEvent.change(input, { target: { value: "Fishing" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({ kind: "text", value: "Fishing" });
});

it("picking a family suggestion adds a FAMILY token", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  fireEvent.change(getByPlaceholderText(/add a tag or name/i), { target: { value: "Boud" } });
  fireEvent.click(getByText("The Boudreaux Family"));
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({
    kind: "family",
    familyId: "f1",
    name: "The Boudreaux Family",
  });
});

it("the 'Add as person' row emits a person token with a null id", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  fireEvent.change(getByPlaceholderText(/add a tag or name/i), { target: { value: "Uncle Jim" } });
  fireEvent.click(getByText(/add .*uncle jim.* as a person/i));
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({
    kind: "person",
    personId: null,
    displayName: "Uncle Jim",
  });
});

it("removing a family chip fires onRemove with the family token", () => {
  const onRemove = vi.fn();
  const tokens: TagToken[] = [{ kind: "family", familyId: "f1", name: "The Boudreaux Family" }];
  const { getByLabelText } = render(
    <TagInput tokens={tokens} suggestions={suggestions} onAdd={vi.fn()} onRemove={onRemove} />,
  );
  fireEvent.click(getByLabelText(/remove the boudreaux family/i));
  expect(onRemove).toHaveBeenCalledWith(tokens[0]);
});

it("disabled prevents a dropdown suggestion click from firing onAdd", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} disabled />,
  );
  fireEvent.change(getByPlaceholderText(/add a tag or name/i), { target: { value: "Boud" } });
  fireEvent.click(getByText("The Boudreaux Family"));
  expect(onAdd).not.toHaveBeenCalled();
});

it("Escape closes the dropdown", () => {
  const { getByPlaceholderText, queryByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={vi.fn()} onRemove={vi.fn()} />,
  );
  const input = getByPlaceholderText(/add a tag or name/i);
  fireEvent.change(input, { target: { value: "Boud" } });
  expect(queryByText("The Boudreaux Family")).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(queryByText("The Boudreaux Family")).toBeNull();
});
