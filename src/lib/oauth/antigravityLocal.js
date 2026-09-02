import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ANTIGRAVITY_CONFIG } from "./constants/oauth.js";
import antigravity from "./providers/antigravity.js";

const execFileAsync = promisify(execFile);

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

export function getDefaultAdcWritePath({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    return env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  }
  return platform === "win32"
    ? path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "gcloud", "application_default_credentials.json")
    : path.join(home, ".config", "gcloud", "application_default_credentials.json");
}

export async function saveLocalAdcCredentials(credentials, { fsImpl = fs, targetPath = getDefaultAdcWritePath() } = {}) {
  const dir = path.dirname(targetPath);
  await fsImpl.mkdir(dir, { recursive: true });
  await fsImpl.writeFile(targetPath, JSON.stringify(credentials, null, 2), "utf8");
  return targetPath;
}

export async function removeLocalAdcCredentials({ fsImpl = fs, paths = getAdcCredentialPaths() } = {}) {
  let removedAny = false;
  for (const candidate of paths) {
    try {
      await fsImpl.unlink(candidate);
      removedAny = true;
    } catch {
      // Ignore missing files
    }
  }
  return removedAny;
}

function isAuthorizedUserCredentials(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.type === "authorized_user"
    && typeof value.refresh_token === "string"
    && value.refresh_token.trim().length > 0;
}

const WIN_CRED_READER_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CredReaderHelper {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr ptr);
    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr ptr);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    public static string Read(string target) {
        IntPtr ptr;
        if (CredRead(target, 1, 0, out ptr)) {
            var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
            CredFree(ptr);
            return Encoding.UTF8.GetString(bytes);
        }
        return null;
    }
}
"@
[CredReaderHelper]::Read("gemini:antigravity")
`;

export async function readKeyringCredentials({ execImpl = execFileAsync, platform = process.platform } = {}) {
  if (platform === "win32") {
    try {
      const { stdout } = await execImpl("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        WIN_CRED_READER_SCRIPT,
      ], { timeout: 10000 });

      const trimmed = stdout?.trim();
      if (!trimmed) return null;
      const parsed = JSON.parse(trimmed);
      const token = parsed.token;
      if (token && typeof token.refresh_token === "string" && token.refresh_token.trim().length > 0) {
        return {
          path: "Windows Credential Manager (gemini:antigravity)",
          credentials: {
            type: "authorized_user",
            refresh_token: token.refresh_token.trim(),
            client_id: ANTIGRAVITY_CONFIG.clientId,
            client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          },
        };
      }
    } catch {
      // Keyring read failure: fallback to ADC
    }
  } else if (platform === "darwin") {
    try {
      const { stdout } = await execImpl("security", [
        "find-generic-password",
        "-s", "gemini",
        "-a", "antigravity",
        "-w",
      ], { timeout: 5000 });

      const trimmed = stdout?.trim();
      if (!trimmed) return null;
      const parsed = JSON.parse(trimmed);
      const token = parsed.token;
      if (token && typeof token.refresh_token === "string" && token.refresh_token.trim().length > 0) {
        return {
          path: "macOS Keychain (gemini:antigravity)",
          credentials: {
            type: "authorized_user",
            refresh_token: token.refresh_token.trim(),
            client_id: ANTIGRAVITY_CONFIG.clientId,
            client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          },
        };
      }
    } catch {
      // Keychain read failure: fallback to ADC
    }
  }
  return null;
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

export async function readLocalAntigravityCredentials({
  fsImpl = fs,
  execImpl = execFileAsync,
  platform = process.platform,
  paths = getAdcCredentialPaths({ platform }),
} = {}) {
  // 1. Try native platform keyring first (Antigravity CLI storage)
  const keyring = await readKeyringCredentials({ execImpl, platform });
  if (keyring) return keyring;

  // 2. Fall back to standard Google ADC file
  return await readLocalAdcCredentials({ fsImpl, paths });
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

export async function importLocalAntigravity({
  fsImpl = fs,
  fetchImpl = fetch,
  execImpl = execFileAsync,
  platform = process.platform,
} = {}) {
  const local = await readLocalAntigravityCredentials({ fsImpl, execImpl, platform });
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
