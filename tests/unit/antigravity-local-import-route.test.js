import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importLocalAntigravity: vi.fn(),
  createProviderConnection: vi.fn(),
  json: vi.fn((body, init) => ({ body, status: init?.status || 200 })),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/oauth/antigravityLocal.js", () => ({
  LOCAL_ADC_NOT_FOUND: "LOCAL_ADC_NOT_FOUND",
  importLocalAntigravity: mocks.importLocalAntigravity,
}));
vi.mock("@/models", () => ({ createProviderConnection: mocks.createProviderConnection }));

const { POST } = await import("../../src/app/api/oauth/antigravity/local-import/route.js");

describe("POST /api/oauth/antigravity/local-import", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists imported credentials and never returns token fields", async () => {
    mocks.importLocalAntigravity.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      email: "user@example.com",
      projectId: "project-1",
    });
    mocks.createProviderConnection.mockResolvedValue({
      id: "conn-1", provider: "antigravity", email: "user@example.com", name: "user@example.com",
    });

    const response = await POST(new Request("http://localhost/api/oauth/antigravity/local-import", {
      method: "POST",
      body: "{}",
    }));

    expect(response.body).toEqual({ success: true, connection: {
      id: "conn-1", provider: "antigravity", email: "user@example.com", name: "user@example.com",
    }});
    expect(JSON.stringify(response.body)).not.toContain("refresh");
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: "antigravity",
      authType: "oauth",
      accessToken: "access",
      refreshToken: "refresh",
      providerSpecificData: { projectId: "project-1" },
    }));
  });

  it("returns a clear not-found response when local credentials are unavailable", async () => {
    const error = new Error("No supported local Antigravity credentials found");
    error.code = "LOCAL_ADC_NOT_FOUND";
    mocks.importLocalAntigravity.mockRejectedValue(error);

    const response = await POST(new Request("http://localhost/api/oauth/antigravity/local-import", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("ADC");
    expect(response.body.error).not.toContain("refresh");
  });
});
