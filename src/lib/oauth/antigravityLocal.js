import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ANTIGRAVITY_CONFIG } from "./constants/oauth.js";
import antigravity from "./providers/antigravity.js";

export const LOCAL_ADC_NOT_FOUND = "LOCAL_ADC_NOT_FOUND";

function addCandidate(paths, candidate) {
  if (candidate && !paths.includes(candidate)) paths.push(candidate);
}

export function getAdcCredentialPaths({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const paths = [];
  addCandidate(paths, env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  const defaultPath = platform === "win32"
    ? path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "gcloud", "application_default_credentials.json")
    : path.join(home, ".config", "gcloud", "application_default_credentials.json");
  addCandidate(paths, defaultPath);

  return paths;
}

function isAuthorizedUserCredentials(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.type === "authorized_user"
    && typeof value.refresh_token === "string"
    && value.refresh_token.trim().length > 0;
}

export async function readLocalAdcCredentials({ fsImpl = fs, paths = getAdcCredentialPaths() } = {}) {
  for (const candidate of paths) {
    try {
      const raw = await fsImpl.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (isAuthorizedUserCredentials(parsed)) {
        return { path: candidate, credentials: parsed };
      }
    } catch {
      // Missing, malformed, and unsupported files are skipped.
    }
  }
  return null;
}

export async function exchangeAdcRefreshToken(credentials, fetchImpl = fetch) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refresh_token,
    client_id: credentials.client_id || ANTIGRAVITY_CONFIG.clientId,
    client_secret: credentials.client_secret || ANTIGRAVITY_CONFIG.clientSecret,
  });

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) throw new Error("Google token exchange failed");
  const tokenData = await response.json();
  if (!tokenData?.access_token) throw new Error("Google token exchange returned no access token");
  return tokenData;
}

export async function importLocalAntigravity({ fsImpl = fs, fetchImpl = fetch } = {}) {
  const local = await readLocalAdcCredentials({ fsImpl });
  if (!local) {
    const error = new Error("No supported local Antigravity credentials found");
    error.code = LOCAL_ADC_NOT_FOUND;
    throw error;
  }

  const tokenData = await exchangeAdcRefreshToken(local.credentials, fetchImpl);
  const extra = await antigravity.postExchange(tokenData);
  const projectId = extra?.projectId;

  if (!projectId) throw new Error("No Antigravity project found for the local account");

  return antigravity.mapTokens({
    ...tokenData,
    refresh_token: tokenData.refresh_token || local.credentials.refresh_token,
  }, extra);
}
