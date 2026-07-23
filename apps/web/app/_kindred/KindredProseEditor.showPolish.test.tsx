// @vitest-environment jsdom
/**
 * KindredProseEditor — showPolishButton hides the in-toolbar Polish control when the parent owns it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KindredProseEditor } from "./KindredProseEditor";

afterEach(cleanup);

describe("KindredProseEditor showPolishButton", () => {
  it("renders Polish in the toolbar by default when onPolish is set", () => {
    render(
      <KindredProseEditor value="hello story" onChange={vi.fn()} onPolish={vi.fn(async (t) => t)} />,
    );
    expect(screen.getByRole("button", { name: /polish with ai/i })).toBeTruthy();
  });

  it("hides Polish when showPolishButton is false", () => {
    render(
      <KindredProseEditor
        value="hello story"
        onChange={vi.fn()}
        onPolish={vi.fn(async (t) => t)}
        showPolishButton={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /polish with ai/i })).toBeNull();
  });

  it("hides Undo/Redo when showHistoryButtons is false", () => {
    render(
      <KindredProseEditor
        value="hello story"
        onChange={vi.fn()}
        onPolish={vi.fn(async (t) => t)}
        showPolishButton={false}
        showHistoryButtons={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Undo$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Redo$/i })).toBeNull();
  });
});
