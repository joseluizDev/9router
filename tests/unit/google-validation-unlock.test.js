import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractGoogleValidationInfo } from "open-sse/services/accountFallback.js";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  json: vi.fn((body, init) => ({ body, status: init?.status || 200 })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

const { POST: unlockRoute } = await import("../../src/app/api/providers/[id]/unlock/route.js");

describe("Google validation and unlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractGoogleValidationInfo", () => {
    it("extracts validation_url and message from Google error JSON object", () => {
      const googleError = {
        error: {
          code: 403,
          message: "Verify your account to continue.",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "VALIDATION_REQUIRED",
              metadata: {
                validation_url: "https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=abc123xyz",
                validation_error_message: "Verify your account to continue.",
              },
            },
          ],
        },
      };

      const res = extractGoogleValidationInfo(googleError);
      expect(res.isValidationRequired).toBe(true);
      expect(res.message).toBe("Verify your account to continue.");
      expect(res.validationUrl).toBe("https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=abc123xyz");
    });

    it("extracts validation_url from stringified JSON error", () => {
      const rawText = JSON.stringify({
        error: {
          code: 403,
          message: "Verify your account to continue.",
          details: [
            {
              reason: "VALIDATION_REQUIRED",
              metadata: {
                validation_url: "https://accounts.google.com/signin/continue?token=secret123",
              },
            },
          ],
        },
      });

      const res = extractGoogleValidationInfo(rawText);
      expect(res.isValidationRequired).toBe(true);
      expect(res.message).toBe("Verify your account to continue.");
      expect(res.validationUrl).toBe("https://accounts.google.com/signin/continue?token=secret123");
    });

    it("extracts validation URL via regex fallback if JSON parsing fails on truncated text", () => {
      const truncated = '403: {\n "error": {\n  "message": "Verify your account",\n "details": [{"metadata": {"validation_url": "https://accounts.google.com/signin/continue?sarp=1&plt=test_token_456"';
      const res = extractGoogleValidationInfo(truncated);
      expect(res.isValidationRequired).toBe(true);
      expect(res.validationUrl).toBe("https://accounts.google.com/signin/continue?sarp=1&plt=test_token_456");
      expect(res.message).toBe("Verify your account to continue.");
    });

    it("returns empty result on non-validation errors", () => {
      const res = extractGoogleValidationInfo("429: Too Many Requests");
      expect(res.isValidationRequired).toBe(false);
      expect(res.validationUrl).toBeNull();
      expect(res.message).toBeNull();
    });
  });

  describe("POST /api/providers/[id]/unlock", () => {
    it("clears all modelLock_* keys, resets status to active, and returns safe connection", async () => {
      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-google-1",
        provider: "antigravity",
        email: "test@gmail.com",
        apiKey: "secret-key",
        accessToken: "secret-token",
        refreshToken: "secret-refresh",
        testStatus: "unavailable",
        lastError: "Verify your account to continue.",
        errorCode: 403,
        validationUrl: "https://accounts.google.com/signin/continue?plt=123",
        "modelLock_gemini-3.7-flash-high": "2026-09-02T18:00:00.000Z",
        modelLock___all: "2026-09-02T18:00:00.000Z",
      });

      mocks.updateProviderConnection.mockImplementation(async (id, data) => ({
        id,
        provider: "antigravity",
        email: "test@gmail.com",
        apiKey: "secret-key",
        accessToken: "secret-token",
        ...data,
      }));

      const response = await unlockRoute(
        new Request("http://localhost/api/providers/conn-google-1/unlock", { method: "POST" }),
        { params: Promise.resolve({ id: "conn-google-1" }) }
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-google-1",
        expect.objectContaining({
          testStatus: "active",
          lastError: null,
          errorCode: null,
          validationUrl: null,
          "modelLock_gemini-3.7-flash-high": null,
          modelLock___all: null,
        })
      );

      // Sensitive fields must be stripped from response
      expect(response.body.connection.apiKey).toBeUndefined();
      expect(response.body.connection.accessToken).toBeUndefined();
      expect(response.body.connection.refreshToken).toBeUndefined();
    });

    it("returns 404 when connection does not exist", async () => {
      mocks.getProviderConnectionById.mockResolvedValue(null);

      const response = await unlockRoute(
        new Request("http://localhost/api/providers/missing/unlock", { method: "POST" }),
        { params: Promise.resolve({ id: "missing" }) }
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Connection not found" });
    });
  });
});
