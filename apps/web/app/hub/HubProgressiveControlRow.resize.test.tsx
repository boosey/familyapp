// @vitest-environment jsdom
/**
 * Resize jank guard — HubProgressiveControlRow must not React-commit on every
 * ResizeObserver tick when the resolved expansion is unchanged. Continuous
 * browser resize within one expansion band should be paint-only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { HubProgressiveControlRow } from "./HubProgressiveControlRow";

const WIDTHS = {
  subTabs: { labeled: 200, iconPills: 120, menuIcon: 48 },
  family: { expanded: 180, collapsedIcon: 48 },
  views: { expanded: 140, collapsedIcon: 48 },
  actionLabeled: 100,
  actionIconified: 48,
};

describe("HubProgressiveControlRow resize thrash", () => {
  let roCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    roCallback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          roCallback = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not commit when ResizeObserver fires but expansion is unchanged", () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      // Count updates only — mount is expected; RO ticks must not update.
      if (phase === "update") commits += 1;
    };

    render(
      <Profiler id="progressive-row" onRender={onRender}>
        <HubProgressiveControlRow
          forceWidths={WIDTHS}
          subTabs={{
            labeled: <span>st-l</span>,
            iconPills: <span>st-p</span>,
            menuIcon: <span>st-m</span>,
          }}
          family={{
            expanded: <span>fam-e</span>,
            collapsed: <span>fam-c</span>,
          }}
          views={{
            expanded: <span>vw-e</span>,
            collapsed: <span>vw-c</span>,
          }}
          action={{
            labeled: <span>act-l</span>,
            iconified: <span>act-i</span>,
          }}
        />
      </Profiler>,
    );

    const row = document.querySelector(
      "[data-hub-progressive-control-row]",
    ) as HTMLElement;
    expect(row).toBeTruthy();
    expect(roCallback).not.toBeNull();

    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      width: 900,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 900,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });

    // Flush any pending layout-effect recompute before measuring RO thrash.
    act(() => {
      roCallback?.(
        [
          {
            target: row,
            contentRect: row.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    const afterSettled = commits;

    // Separate act() per tick — mirrors real resize (one RO delivery per frame),
    // not a single batched event-handler burst.
    for (let i = 0; i < 20; i++) {
      act(() => {
        roCallback?.(
          [
            {
              target: row,
              contentRect: row.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });
    }

    // Green: equal expansion → setState bails → zero extra update commits.
    // Red: each RO tick setExpansion(new object) → one commit per frame.
    expect(commits - afterSettled).toBe(0);
  });

  it("still commits when ResizeObserver crosses an expansion threshold", () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      if (phase === "update") commits += 1;
    };

    render(
      <Profiler id="progressive-row-threshold" onRender={onRender}>
        <HubProgressiveControlRow
          forceWidths={WIDTHS}
          subTabs={{
            labeled: <span>st-l</span>,
            iconPills: <span>st-p</span>,
            menuIcon: <span>st-m</span>,
          }}
          family={{
            expanded: <span>fam-e</span>,
            collapsed: <span>fam-c</span>,
          }}
          views={{
            expanded: <span>vw-e</span>,
            collapsed: <span>vw-c</span>,
          }}
          action={{
            labeled: <span>act-l</span>,
            iconified: <span>act-i</span>,
          }}
        />
      </Profiler>,
    );

    const row = document.querySelector(
      "[data-hub-progressive-control-row]",
    ) as HTMLElement;
    const rect = {
      width: 900,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 900,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    };
    const spy = vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect);

    act(() => {
      roCallback?.(
        [
          {
            target: row,
            contentRect: row.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
    const afterWide = commits;

    // Collapse secondaries: budget too tight for expanded family/views.
    spy.mockReturnValue({ ...rect, width: 100, right: 100 });
    act(() => {
      roCallback?.(
        [
          {
            target: row,
            contentRect: row.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    expect(commits).toBeGreaterThan(afterWide);
  });
});
