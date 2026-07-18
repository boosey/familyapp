// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BreathingWaveform } from "./BreathingWaveform";

describe("BreathingWaveform", () => {
  it("renders animated bars when motion is allowed", () => {
    const { container } = render(
      <BreathingWaveform level={0.5} reduceMotion={false} bars={5} />,
    );
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(5);
    expect(container.querySelector('[data-static-bar="true"]')).toBeNull();
  });

  it("defaults to 7 bars", () => {
    const { container } = render(
      <BreathingWaveform level={0.5} reduceMotion={false} />,
    );
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(7);
  });

  it("renders a single static level bar under reduced motion", () => {
    const { container } = render(
      <BreathingWaveform level={0.5} reduceMotion={true} bars={5} />,
    );
    expect(container.querySelector('[data-static-bar="true"]')).toBeTruthy();
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
  });

  it("carries no text (decorative, aria-hidden)", () => {
    const { container } = render(
      <BreathingWaveform level={0.5} reduceMotion={false} bars={5} />,
    );
    expect(container.textContent).toBe("");
  });
});
