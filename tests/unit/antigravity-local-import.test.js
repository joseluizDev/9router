import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  exchangeAdcRefreshToken,
  getAdcCredentialPaths,
  importLocalAntigravity,
  readLocalAdcCredentials,
} from "../../src/lib/oauth/antigravityLocal.js";
import antigravity from "../../src/lib/oauth/providers/antigravity.js";

describe("Antigravity local credentials", () => {
  it("prefers GOOGLE_APPLICATION_CREDENTIALS before the platform default", () => {
    expect(getAdcCredentialPaths({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "D:/secrets/adc.json", APPDATA: "C:/Users/test/AppData/Roaming" },
      platform: "win32",
      home: "C:/Users/test",
    })).toEqual([
      "D:/secrets/adc.json",
      path.join("C:/Users/test/AppData/Roaming", "gcloud", "application_default_credentials.json"),
    ]);
  });

  it("skips malformed and unsupported ADC files", async () => {
    const files = new Map([
      ["bad.json", "not-json"],
      ["unsupported.json", JSON.stringify({ type: "service_account", refresh_token: "secret" })],
      ["valid.json", JSON.stringify({ type: "authorized_user", refresh_token: "refresh" })],
    ]);
    const fsImpl = { readFile: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error("ENOENT");
      return files.get(path);
    }) };

    await expect(readLocalAdcCredentials({ fsImpl, paths: ["bad.json", "unsupported.json", "valid.json"] }))
      .resolves.toEqual({ path: "valid.json", credentials: { type: "authorized_user", refresh_token: "refresh" } });
  });

  it("exchanges only the refresh credential and validates the access token", async () => {
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      json: async () => ({ access_token: "access", expires_in: 3600, scope: "scope" }),
    }));
    await expect(exchangeAdcRefreshToken({ refresh_token: "refresh", client_id: "client", client_secret: "secret" }, fetchImpl))
      .resolves.toMatchObject({ access_token: "access" });
    expect(fetchImpl).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.objectContaining({ method: "POST" }));
  });

  it("maps the local credential into an Antigravity connection payload", async () => {
    const postExchange = vi.spyOn(antigravity, "postExchange").mockResolvedValue({
      userInfo: { email: "user@example.com" },
      projectId: "project-1",
    });
    const mapTokens = vi.spyOn(antigravity, "mapTokens").mockImplementation((tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      email: extra.userInfo.email,
      projectId: extra.projectId,
    }));
    const fsImpl = { readFile: vi.fn(async () => JSON.stringify({
      type: "authorized_user",
      refresh_token: "refresh",
    })) };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "access", refresh_token: "rotated", expires_in: 3600 }),
    }));

    await expect(importLocalAntigravity({ fsImpl, fetchImpl })).resolves.toEqual({
      accessToken: "access",
      refreshToken: "rotated",
      expiresIn: 3600,
      email: "user@example.com",
      projectId: "project-1",
    });

    postExchange.mockRestore();
    mapTokens.mockRestore();
  });
});
