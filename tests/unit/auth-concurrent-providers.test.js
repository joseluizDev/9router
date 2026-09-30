import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn().mockResolvedValue({}),
  getProxyPools: vi.fn().mockResolvedValue([]),
  validateApiKey: vi.fn().mockResolvedValue(true),
}));

import { getProviderConnections } from "@/lib/localDb";
import { getProviderCredentials } from "@/sse/services/auth.js";

describe("auth concurrent provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not block provider B when provider A takes time", async () => {
    let resolveOpenAI;
    const openAiWait = new Promise((resolve) => { resolveOpenAI = resolve; });

    getProviderConnections.mockImplementation(async ({ provider }) => {
      if (provider === "openai") {
        await openAiWait;
        return [{ id: "c-openai", provider: "openai", isActive: true, apiKey: "sk-openai" }];
      }
      if (provider === "anthropic") {
        return [{ id: "c-anthropic", provider: "anthropic", isActive: true, apiKey: "sk-anthropic" }];
      }
      return [];
    });

    // Start OpenAI first (which hangs until openAiWait is resolved)
    const pOpenAI = getProviderCredentials("openai");

    // Anthropic should complete immediately without waiting for OpenAI
    let anthropicDone = false;
    const pAnthropic = getProviderCredentials("anthropic").then((res) => {
      anthropicDone = true;
      return res;
    });

    // Small delay to let microtasks run
    await new Promise((r) => setTimeout(r, 50));

    // In a partitioned mutex design, Anthropic must be done even while OpenAI is still waiting
    expect(anthropicDone).toBe(true);
    const resAnthropic = await pAnthropic;
    expect(resAnthropic.apiKey).toBe("sk-anthropic");

    // Now finish OpenAI
    resolveOpenAI();
    const resOpenAI = await pOpenAI;
    expect(resOpenAI.apiKey).toBe("sk-openai");
  });
});
