/**
 * Adapter tests — no live Inngest calls. We inject a stub `InngestLike` with a `.send` spy and
 * a `.createFunction` that returns an object carrying the wiring metadata we need to assert on.
 *
 * What we pin:
 * - `enqueue` produces a STABLE dedupe id for identical payloads (idempotent re-enqueue).
 * - `enqueue` translates `JobName` -> `chronicle/<name>` event name.
 * - `register` adds a function to the `functions` getter and is replace-on-re-register.
 * - `drain()` is a no-op and resolves.
 * - `pending()` returns `[]`.
 */
import { describe, expect, it, vi } from "vitest";
import { canonicalJson, createInngestJobQueue, type InngestLike } from "../src/index";

/**
 * Stub mirroring the **real** `InngestFunction.id()` shape: when called without an explicit
 * prefix arg, the SDK returns `"<appId>-<functionId>"` (prefix-qualified), not the bare
 * `functionId` we passed into `createFunction({ id })`. The adapter must not depend on that
 * format for replace semantics.
 */
function stubClientWithPrefixedId(appId = "family-chronicle") {
  const send = vi.fn(async () => ({ ids: ["evt_test"] }));
  const createFunction = vi.fn(
    (opts: { id: string }, trigger: { event: string }, handler: unknown) => ({
      id: () => `${appId}-${opts.id}`,
      __opts: opts,
      __trigger: trigger,
      __handler: handler,
    }),
  );
  return { client: { send, createFunction } as unknown as InngestLike };
}

function stubClient() {
  const send = vi.fn(async (_p: { name: string; data: unknown; id?: string }) => ({
    ids: ["evt_test"],
  }));
  const createFunction = vi.fn(
    (opts: { id: string }, trigger: { event: string }, handler: unknown) => ({
      // Mirror the surface of an InngestFunction we read from in src: `.id()` returns the id.
      id: () => opts.id,
      // Stash everything for assertions.
      __opts: opts,
      __trigger: trigger,
      __handler: handler,
    }),
  );
  return {
    client: { send, createFunction } as unknown as InngestLike,
    send,
    createFunction,
  };
}

describe("createInngestJobQueue — enqueue", () => {
  it("translates JobName to `chronicle/<name>` event", async () => {
    const { client, send } = stubClient();
    const q = createInngestJobQueue({ client });
    await q.enqueue("transcribe", { storyId: "abc" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]!.name).toBe("chronicle/transcribe");
    expect(send.mock.calls[0]![0]!.data).toEqual({ storyId: "abc" });
  });

  it("forwards payload as `data`", async () => {
    const { client, send } = stubClient();
    const q = createInngestJobQueue({ client });
    await q.enqueue("render_story", { storyId: "story-xyz" });
    expect(send.mock.calls[0]![0]!.data).toEqual({ storyId: "story-xyz" });
    expect(send.mock.calls[0]![0]!.name).toBe("chronicle/render_story");
  });

  it("produces the SAME dedupe id for identical (name, payload) — idempotent re-enqueue", async () => {
    const { client, send } = stubClient();
    const q = createInngestJobQueue({ client });
    const id1 = await q.enqueue("transcribe", { storyId: "abc" });
    const id2 = await q.enqueue("transcribe", { storyId: "abc" });
    expect(id1).toBe(id2);
    // And both `send` calls carry that id — Inngest will collapse to one run.
    expect(send.mock.calls[0]![0]!.id).toBe(id1);
    expect(send.mock.calls[1]![0]!.id).toBe(id1);
  });

  it("produces DIFFERENT dedupe ids for different storyIds", async () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    const a = await q.enqueue("transcribe", { storyId: "a" });
    const b = await q.enqueue("transcribe", { storyId: "b" });
    expect(a).not.toBe(b);
  });

  it("produces DIFFERENT dedupe ids for the same payload across different stages", async () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    const t = await q.enqueue("transcribe", { storyId: "abc" });
    const r = await q.enqueue("render_story", { storyId: "abc" });
    expect(t).not.toBe(r);
  });
});

describe("createInngestJobQueue — register / functions", () => {
  it("register creates an InngestFunction and exposes it via the `functions` getter", () => {
    const { client, createFunction } = stubClient();
    const q = createInngestJobQueue({ client });
    expect(q.functions).toHaveLength(0);
    q.register("transcribe", async () => {});
    expect(createFunction).toHaveBeenCalledTimes(1);
    expect(q.functions).toHaveLength(1);
    // Trigger event matches what `enqueue` sends.
    const wired = createFunction.mock.calls[0]!;
    expect(wired[1]).toEqual({ event: "chronicle/transcribe" });
    expect(wired[0]).toEqual({ id: "chronicle-transcribe" });
  });

  it("registering both stages exposes both functions", () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    q.register("transcribe", async () => {});
    q.register("render_story", async () => {});
    expect(q.functions).toHaveLength(2);
    const ids = q.functions
      .map((f) => (f as unknown as { id: () => string }).id())
      .sort();
    expect(ids).toEqual(["chronicle-render_story", "chronicle-transcribe"]);
  });

  it("re-registering the same stage REPLACES the function (mirrors in-proc semantics)", () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    q.register("transcribe", async () => {});
    q.register("transcribe", async () => {});
    // Still exactly one function for this stage.
    expect(q.functions).toHaveLength(1);
  });

  it(
    "REGRESSION: replace works against the real SDK's prefix-qualified `.id()` " +
      "(e.g. 'family-chronicle-chronicle-transcribe'), not just bare 'chronicle-transcribe'",
    () => {
      // Pre-fix: the adapter compared `.id()` string equality to the bare functionId, so the
      // real SDK's prefixed id would never match and re-register silently appended a duplicate.
      // Map-keyed-by-JobName makes replace structurally correct regardless of id format.
      const { client } = stubClientWithPrefixedId("family-chronicle");
      const q = createInngestJobQueue({ client });
      q.register("transcribe", async () => {});
      q.register("transcribe", async () => {});
      expect(q.functions).toHaveLength(1);
      // Sanity: the stub really is producing prefix-qualified ids.
      const onlyFn = q.functions[0] as unknown as { id: () => string };
      expect(onlyFn.id()).toBe("family-chronicle-chronicle-transcribe");
    },
  );

  it("the `functions` getter returns a FRESH array per call (snapshot, not live view)", () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    q.register("transcribe", async () => {});
    const first = q.functions;
    const second = q.functions;
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    // And new registrations appear in subsequent reads.
    q.register("render_story", async () => {});
    expect(first).toHaveLength(1);
    expect(q.functions).toHaveLength(2);
  });

  it("the registered handler is invoked with `event.data` typed as JobPayload", async () => {
    const { client, createFunction } = stubClient();
    const q = createInngestJobQueue({ client });
    const received: unknown[] = [];
    q.register("transcribe", async (payload) => {
      received.push(payload);
    });
    // Invoke the inner handler the way Inngest would.
    const inner = createFunction.mock.calls[0]![2] as (args: {
      event: { data: unknown };
    }) => Promise<void>;
    await inner({ event: { data: { storyId: "from-event" } } });
    expect(received).toEqual([{ storyId: "from-event" }]);
  });
});

describe("createInngestJobQueue — contract honesty", () => {
  it("drain() is a no-op and resolves", async () => {
    const { client, send } = stubClient();
    const q = createInngestJobQueue({ client });
    await q.enqueue("transcribe", { storyId: "abc" });
    await expect(q.drain()).resolves.toBeUndefined();
    // No extra sends triggered by drain.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pending() returns []", async () => {
    const { client } = stubClient();
    const q = createInngestJobQueue({ client });
    await q.enqueue("transcribe", { storyId: "abc" });
    expect(q.pending()).toEqual([]);
  });
});

describe("canonicalJson — key-sort invariant", () => {
  it("produces the same string regardless of key insertion order", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("recurses into nested objects with sorted keys", () => {
    const a = canonicalJson({ outer: { b: 2, a: 1 }, z: 9 });
    const b = canonicalJson({ z: 9, outer: { a: 1, b: 2 } });
    expect(a).toBe(b);
    expect(a).toBe('{"outer":{"a":1,"b":2},"z":9}');
  });
});
