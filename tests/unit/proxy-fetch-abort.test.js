import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";

const transport = vi.hoisted(() => ({ sockets: [], requests: [], resolvers: [] }));
vi.mock("dns", () => ({
  Resolver: class {
    constructor() { transport.resolvers.push(this); }
    setServers() {}
    resolve4(host, callback) { this.callback = callback; }
    cancel() { this.cancelled = true; this.callback(new Error("DNS cancelled")); }
  },
}));
vi.mock("net", () => ({ default: { Socket: class extends EventEmitter {
  constructor() { super(); transport.sockets.push(this); }
  connect(port, ip, callback) { this.connected = callback; }
  destroy() { this.destroyed = true; this.emit("close"); }
} } }));
vi.mock("https", () => ({ default: { request: (options, callback) => {
  const req = new EventEmitter();
  Object.assign(req, { options, respond: callback, write() {}, end() {}, destroy(error) {
    this.destroyed = true;
    if (error) this.emit("error", error);
    this.emit("close");
  } });
  transport.requests.push(req);
  return req;
} } }));
vi.mock("undici", () => ({ ProxyAgent: class {}, Agent: class {}, setGlobalDispatcher: () => {} }));

const url = "https://cloudcode-pa.googleapis.com/v1/test";
let fetchRequest;
let nativeFetch;
let controller;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const listeners = () => getEventListeners(controller.signal, "abort");

beforeEach(async () => {
  vi.resetModules();
  transport.sockets = [];
  transport.requests = [];
  transport.resolvers = [];
  for (const name of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(name, "");
  nativeFetch = vi.fn().mockResolvedValue(new Response("fallback"));
  vi.stubGlobal("fetch", nativeFetch);
  controller = new AbortController();
  ({ proxyAwareFetch: fetchRequest } = await import("../../open-sse/utils/proxyFetch.js"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function start(stage) {
  const pending = fetchRequest(url, { signal: controller.signal });
  const result = pending.catch(error => error);
  await vi.waitFor(() => expect(transport.resolvers).toHaveLength(1));
  if (stage !== "dns") {
    transport.resolvers[0].callback(null, ["203.0.113.1"]);
    await vi.waitFor(() => expect(transport.sockets).toHaveLength(1));
  }
  if (stage === "headers" || stage === "body") transport.sockets[0].connected();
  return { pending, result };
}

describe("proxy fetch cancellation", () => {
  it("rejects pre-aborted requests without starting transport", async () => {
    controller.abort();
    const result = fetchRequest(url, { signal: controller.signal }).catch(error => error);
    await flush();
    expect(transport.resolvers).toHaveLength(0);
    expect(await result).toBe(controller.signal.reason);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each(["dns", "tcp", "headers"])("cancels pending %s without fallback or retained listeners", async (stage) => {
    const { result } = await start(stage);
    const reason = new Error("deadline exceeded");
    controller.abort(reason);
    await flush();
    if (stage === "dns") expect(transport.resolvers[0].cancelled).toBe(true);
    else expect(transport.sockets[0].destroyed).toBe(true);
    if (stage === "headers") expect(transport.requests[0].destroyed).toBe(true);
    expect(await result).toBe(reason);
    expect(listeners()).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("aborts the response body after headers and releases listeners", async () => {
    const { pending } = await start("body");
    const incoming = new PassThrough();
    Object.assign(incoming, { statusCode: 200, statusMessage: "OK", headers: {} });
    transport.requests[0].respond(incoming);
    const response = await pending;
    const read = response.body.getReader().read().catch(error => error);
    controller.abort();
    await flush();
    expect(incoming.destroyed).toBe(true);
    expect(await read).toBe(controller.signal.reason);
    expect(listeners()).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("preserves healthy streaming and TLS hostname validation", async () => {
    const { pending } = await start("body");
    const req = transport.requests[0];
    const incoming = new PassThrough();
    Object.assign(incoming, { statusCode: 200, statusMessage: "OK", headers: {} });
    req.respond(incoming);
    const response = await pending;
    const reader = response.body.getReader();
    incoming.end("hello");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("hello");
    expect((await reader.read()).done).toBe(true);
    expect(req.options.servername).toBe("cloudcode-pa.googleapis.com");
    expect(req.options.rejectUnauthorized).not.toBe(false);
    expect(listeners()).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each(["tcp", "headers"])("cleans up failed %s transport before the existing fallback", async (stage) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = await start(stage);
    const source = stage === "tcp" ? transport.sockets[0] : transport.requests[0];
    source.emit("error", new Error("connection failed"));
    expect(await (await result).text()).toBe("fallback");
    expect(transport.sockets[0].destroyed).toBe(true);
    expect(listeners()).toHaveLength(0);
  });

  it("cleans up DNS listeners on lookup failure before native fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = await start("dns");
    transport.resolvers[0].callback(new Error("no records"));
    expect(await (await result).text()).toBe("fallback");
    expect(listeners()).toHaveLength(0);
  });

  it.each([url, "https://example.com/test"])("does not retry an aborted proxy call to %s", async (target) => {
    nativeFetch.mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    const result = await fetchRequest(target, { signal: controller.signal }, { enabled: true, url: "http://localhost:8080" }).catch(error => error);
    expect(result).toBe(controller.signal.reason);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(transport.resolvers).toHaveLength(0);
  });
});
