import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { APIKEY_PROVIDERS } from "@/shared/constants/providers";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => ({
    id: "zro-test", provider: "zro", authType: "apikey", apiKey: "sk-test-zro",
  })),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

import { POST } from "@/app/api/providers/validate/route.js";
import { testSingleConnection } from "@/app/api/providers/[id]/test/testUtils.js";
import { updateProviderConnection } from "@/lib/localDb";

const MODEL_IDS = [
  "deepseek-v4.1-flash", "glm-5.3", "glm-5.3-flash",
  "dolly1-security", "dolly2-security", "auto",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ZRO provider", () => {
  it("offers the documented models as an API-key provider in the dashboard", () => {
    expect(APIKEY_PROVIDERS.zro).toMatchObject({
      id: "zro", name: "ZRO (Moonmath)", authType: "apikey",
    });
    expect(PROVIDER_MODELS.zro.map((model) => model.id)).toEqual(MODEL_IDS);
  });

  it.each([false, true])("routes bare model IDs and bearer credentials to ZRO (stream=%s)", (stream) => {
    const executor = new DefaultExecutor("zro");
    const credentials = { apiKey: "sk-test-zro" };
    for (const id of MODEL_IDS) {
      const parsed = parseModel(`zro/${id}`);
      expect(parsed).toMatchObject({ provider: "zro", model: id });
      expect(executor.buildUrl(parsed.model, stream, 0, credentials))
        .toBe("https://zro.moonmath.ai/v1/chat/completions");
    }
    expect(executor.buildHeaders(credentials, stream)).toMatchObject({
      Authorization: "Bearer sk-test-zro", "Content-Type": "application/json",
    });
  });

  it.each([200, 401, 403, 500])("validates new keys with only a models GET (HTTP %s)", async (status) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "zro", apiKey: "sk-test-zro" }),
    }));
    expect(await response.json()).toMatchObject({ valid: status === 200 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://zro.moonmath.ai/v1/models", expect.objectContaining({
      headers: { Authorization: "Bearer sk-test-zro" },
    }));
  });

  it.each([200, 401, 500])("tests a saved connection through the existing credential flow (HTTP %s)", async (status) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testSingleConnection("zro-test");
    expect(result.valid).toBe(status === 200);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://zro.moonmath.ai/v1/models", expect.objectContaining({
      headers: { Authorization: "Bearer sk-test-zro" },
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("zro-test", expect.objectContaining({
      testStatus: status === 200 ? "active" : "error",
    }));
  });
});
