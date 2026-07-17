// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KindredVoiceButton } from "./KindredVoiceButton";
import { common } from "@/app/_copy";

describe("KindredVoiceButton — tap-toggle (default)", () => {
  it("fires onClick on click and does not attach hold handlers", () => {
    const onClick = vi.fn();
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const { container } = render(
      <KindredVoiceButton onClick={onClick} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />,
    );
    const btn = container.querySelector("button")!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Without holdToRecord, pointer events must not trigger the hold callbacks.
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it("uses the tap-to-speak caption when idle", () => {
    const { container } = render(<KindredVoiceButton />);
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe(common.voiceButton.tapToSpeak);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("KindredVoiceButton — hold-to-record", () => {
  it("pointerDown starts and pointerUp finishes; click does not double-fire", () => {
    const onClick = vi.fn();
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const { container } = render(
      <KindredVoiceButton
        holdToRecord
        onClick={onClick}
        onHoldStart={onHoldStart}
        onHoldEnd={onHoldEnd}
      />,
    );
    const btn = container.querySelector("button")!;
    fireEvent.pointerDown(btn);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    // onClick must NOT be wired in hold mode (the pointer handlers own start/finish).
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pointerLeave finishes (releasing off the button still stops)", () => {
    const onHoldEnd = vi.fn();
    const { container } = render(
      <KindredVoiceButton holdToRecord listening onHoldStart={vi.fn()} onHoldEnd={onHoldEnd} />,
    );
    const btn = container.querySelector("button")!;
    fireEvent.pointerLeave(btn);
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it("shows the hold-to-speak caption idle and release-to-finish while listening", () => {
    const idle = render(<KindredVoiceButton holdToRecord />);
    expect(idle.container.querySelector("button")!.getAttribute("aria-label")).toBe(
      common.voiceButton.holdToSpeak,
    );
    const live = render(<KindredVoiceButton holdToRecord listening />);
    expect(live.container.querySelector("button")!.getAttribute("aria-label")).toBe(
      common.voiceButton.releaseToFinish,
    );
  });

  it("renders the provided waveform in place of the stop glyph while listening", () => {
    const { container } = render(
      <KindredVoiceButton
        holdToRecord
        listening
        waveform={<div data-testid="wf" />}
      />,
    );
    expect(container.querySelector('[data-testid="wf"]')).toBeTruthy();
  });

  it("does not fire hold callbacks while disabled or saving", () => {
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const { container } = render(
      <KindredVoiceButton holdToRecord disabled onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />,
    );
    const btn = container.querySelector("button")!;
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
  });
});
