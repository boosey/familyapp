// @vitest-environment jsdom
/**
 * KindredProseEditor: the opt-in "Polish with AI" button pushes the parent's onPolish result into the
 * editor as a reversible history entry, and a polish FAILURE is non-destructive (words unchanged +
 * an inline error).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { KindredProseEditor } from "@/app/_kindred/KindredProseEditor";

function Harness({ onPolish }: { onPolish?: (t: string) => Promise<string> }) {
  const [value, setValue] = useState("um, so, initial words, you know");
  return <KindredProseEditor value={value} onChange={setValue} onPolish={onPolish} />;
}

const ta = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("KindredProseEditor — Polish with AI", () => {
  afterEach(() => cleanup());

  it("replaces the prose with the polished result, then undo restores the original", async () => {
    render(<Harness onPolish={async () => "Initial words."} />);
    expect(ta().value).toBe("um, so, initial words, you know");

    fireEvent.click(screen.getByRole("button", { name: /polish with ai/i }));
    await waitFor(() => expect(ta().value).toBe("Initial words."));

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(ta().value).toBe("um, so, initial words, you know");
  });

  it("a polish failure leaves the words unchanged and shows an inline error", async () => {
    render(
      <Harness
        onPolish={async () => {
          throw new Error("polish failed");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /polish with ai/i }));
    await screen.findByText(/couldn't polish that just now/i);
    expect(ta().value).toBe("um, so, initial words, you know");
  });

  it("does not render a polish button when no onPolish is provided", () => {
    render(<KindredProseEditor value="hi" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /polish with ai/i })).toBeNull();
  });
});
