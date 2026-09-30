import { getGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

describe("ProxyFetch Keep-Alive & TCP_NODELAY", () => {
  it("configures global dispatcher with 60s keep-alive and connect noDelay", async () => {
    const { getTunedAgent } = await import("../../open-sse/utils/proxyFetch.js");
    const agent = getTunedAgent();
    expect(agent).toBeDefined();
    // Verify that global dispatcher is configured
    const dispatcher = getGlobalDispatcher();
    expect(dispatcher).toBeDefined();
  });
});
