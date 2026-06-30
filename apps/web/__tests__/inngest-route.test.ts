/**
 * Tests for the Inngest serve route (app/api/inngest/route.ts).
 *
 * Two layers:
 *  1. STATIC contract (existing): the module imports without booting the runtime and exports
 *     GET/POST/PUT + the `nodejs` runtime marker. The GET/POST/PUT method set was confirmed against
 *     inngest@3.54.2's `serve()` object form via Context7.
 *  2. LAZY-BUILD logic (new): with `getRuntime` and `inngest/next`'s `serve` mocked (no PGlite boot,
 *     no network), assert (a) the serve handler is built ONCE and reused across requests via the
 *     memoized promise, (b) when `rt.inngest` is undefined every method returns 503, and (c) a
 *     failed build clears the memo so the next request retries.
 *
 * The logic tests use `vi.resetModules()` + `vi.doMock()` + dynamic import so each gets a FRESH
 * route module with its own module-scope memo (`handlersPromise`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as staticRoute from "../app/api/inngest/route";

const REQ = () => new Request("http://localhost/api/inngest");

describe("app/api/inngest/route — static contract", () => {
  it("exports GET, POST, and PUT as callable handlers", () => {
    expect(typeof staticRoute.GET).toBe("function");
    expect(typeof staticRoute.POST).toBe("function");
    expect(typeof staticRoute.PUT).toBe("function");
  });

  it("declares the nodejs runtime (runtime singleton needs Node APIs)", () => {
    expect(staticRoute.runtime).toBe("nodejs");
  });
});

/** Fake { GET, POST, PUT } as inngest/next's serve() returns — each replies 200. */
function fakeServeHandlers() {
  return {
    GET: vi.fn(async () => new Response("get", { status: 200 })),
    POST: vi.fn(async () => new Response("post", { status: 200 })),
    PUT: vi.fn(async () => new Response("put", { status: 200 })),
  };
}

async function loadRoute(opts: {
  getRuntimeImpl: () => Promise<unknown>;
  serveImpl?: () => unknown;
}) {
  vi.resetModules();
  const serveMock = vi.fn(opts.serveImpl ?? (() => fakeServeHandlers()));
  const getRuntimeMock = vi.fn(opts.getRuntimeImpl);
  vi.doMock("inngest/next", () => ({ serve: serveMock }));
  vi.doMock("@/lib/runtime", () => ({ getRuntime: getRuntimeMock }));
  const route = await import("../app/api/inngest/route");
  return { route, serveMock, getRuntimeMock };
}

describe("app/api/inngest/route — lazy build + memoization", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("inngest/next");
    vi.doUnmock("@/lib/runtime");
  });

  it("builds the serve handler ONCE and reuses it across requests", async () => {
    const { route, serveMock, getRuntimeMock } = await loadRoute({
      getRuntimeImpl: async () => ({ inngest: { client: {}, functions: [] } }),
    });

    const r1 = await route.GET(REQ());
    const r2 = await route.POST(REQ());
    const r3 = await route.PUT(REQ());

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    // Lazy + memoized: getRuntime and serve each ran exactly once despite three requests.
    expect(getRuntimeMock).toHaveBeenCalledTimes(1);
    expect(serveMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 from GET/POST/PUT when Inngest is not configured (rt.inngest undefined)", async () => {
    const { route, serveMock } = await loadRoute({
      getRuntimeImpl: async () => ({ inngest: undefined }),
    });

    for (const method of ["GET", "POST", "PUT"] as const) {
      const res = await route[method](REQ());
      expect(res.status).toBe(503);
    }
    // No serve handler is ever built when unconfigured.
    expect(serveMock).not.toHaveBeenCalled();
  });

  it("clears the memo on a failed build so the next request retries", async () => {
    let attempt = 0;
    const { route, serveMock, getRuntimeMock } = await loadRoute({
      getRuntimeImpl: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("boom: transient build failure");
        return { inngest: { client: {}, functions: [] } };
      },
    });

    // First request: build rejects → the error propagates and the memo is cleared.
    await expect(route.GET(REQ())).rejects.toThrow("boom: transient build failure");
    // Second request: memo was cleared, so it builds again and now succeeds.
    const res = await route.GET(REQ());
    expect(res.status).toBe(200);

    expect(getRuntimeMock).toHaveBeenCalledTimes(2);
    expect(serveMock).toHaveBeenCalledTimes(1); // only the successful build calls serve
  });
});
