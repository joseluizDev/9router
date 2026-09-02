import { execSync } from "child_process";

const raw = execSync("powershell -NoProfile -ExecutionPolicy Bypass -File scripts/read-cred.ps1", { encoding: "utf8" });
const json = JSON.parse(raw.trim());
console.log("Token expiry:", json.token?.expiry);
console.log("Auth method:", json.auth_method);

const token = json.token?.access_token;
console.log("Token prefix:", token?.slice(0, 15));

async function main() {
  const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const userInfo = await userinfoRes.json();
  console.log("Userinfo:", userInfo.email, userInfo.name);

  // Test loadCodeAssist
  const lcaRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "antigravity/ide/2.1.1 darwin/arm64"
    },
    body: JSON.stringify({
      metadata: {
        ideType: 9,
        platform: 5,
        pluginType: 2
      }
    })
  });

  console.log("loadCodeAssist HTTP status:", lcaRes.status);
  const lcaText = await lcaRes.text();
  console.log("loadCodeAssist raw text:", lcaText);
  let lcaData = {};
  try { lcaData = JSON.parse(lcaText); } catch {}

  const projectId = lcaData.cloudaicompanionProject || "cloudcode-pa-prod";

  const testCases = [
    { host: "daily-cloudcode-pa.googleapis.com", path: "v1internal:generateContent", model: "gemini-3.8-flash" },
    { host: "daily-cloudcode-pa.googleapis.com", path: "v1internal:generateContent", model: "gemini-3.8-flash-medium" },
    { host: "cloudcode-pa.googleapis.com", path: "v1internal:generateContent", model: "gemini-3.8-flash" },
    { host: "cloudcode-pa.googleapis.com", path: "v1internal:generateContent", model: "gemini-3.8-flash-medium" },
    { host: "daily-cloudcode-pa.googleapis.com", path: "v1internal/models/gemini-3.8-flash:generateContent", model: "gemini-3.8-flash" },
    { host: "daily-cloudcode-pa.googleapis.com", path: "v1internal/models/gemini-3.8-flash-tiered:generateContent", model: "gemini-3.8-flash-tiered" },
  ];

  for (const tc of testCases) {
    const url = `https://${tc.host}/${tc.path}`;
    const genRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "antigravity/ide/2.1.1 darwin/arm64",
        "x-client-version": "2.1.1",
        "x-goog-api-client": "antigravity/2.1.1"
      },
      body: JSON.stringify({
        model: tc.model,
        project: projectId,
        request: {
          contents: [{ role: "user", parts: [{ text: "ping" }] }]
        }
      })
    });
    console.log(`URL ${url} (${tc.model}) status:`, genRes.status);
    if (genRes.status === 200) {
      const txt = await genRes.text();
      console.log("SUCCESS:", txt.slice(0, 100));
    }
  }
}

main().catch(console.error);
