import { vi } from "vitest";

/**
 * Route transport requests to `fn`.
 *
 * The transport (open-sse/utils/proxyFetch.js) does not call globalThis.fetch:
 * it calls undici's own fetch, because the dispatcher it builds comes from
 * the npm undici copy and Node's bundled fetch rejects a foreign dispatcher.
 * Stubbing global.fetch alone therefore lets the request reach the network.
 */
export function mockUndiciFetch(fn) {
  vi.doMock("undici", async () => {
    const actual = await vi.importActual("undici");
    return { ...actual, fetch: fn };
  });
  return fn;
}
