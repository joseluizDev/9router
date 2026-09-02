import {
  readLocalAntigravityCredentials,
  removeLocalAdcCredentials,
  saveLocalAdcCredentials
} from "@/lib/oauth/antigravityLocal.js";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth.js";
import antigravity from "@/lib/oauth/providers/antigravity.js";
import { createProviderConnection, deleteProviderConnection, getProviderConnections } from "@/models";
import { NextResponse } from "next/server";

// Standard Google OAuth redirect for manual copy-paste authorization code
const OAUTH_REDIRECT_URI = "https://accounts.google.com/o/oauth2/approval/v2";

export async function GET() {
  try {
    const creds = await readLocalAntigravityCredentials();
    return NextResponse.json({
      installed: !!creds,
      path: creds?.path || null,
      email: creds?.credentials?.account || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, code } = body;

    if (action === "get-auth-url") {
      const params = new URLSearchParams({
        client_id: ANTIGRAVITY_CONFIG.clientId,
        response_type: "code",
        redirect_uri: OAUTH_REDIRECT_URI,
        scope: ANTIGRAVITY_CONFIG.scopes.join(" "),
        access_type: "offline",
        prompt: "consent",
      });
      const authUrl = `${ANTIGRAVITY_CONFIG.authorizeUrl}?${params.toString()}`;
      return NextResponse.json({ authUrl });
    }

    if (action === "exchange-and-save") {
      if (!code || typeof code !== "string" || !code.trim()) {
        return NextResponse.json({ error: "Authorization code is required" }, { status: 400 });
      }

      // 1. Exchange code with Google
      const tokenRes = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ANTIGRAVITY_CONFIG.clientId,
          client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          code: code.trim(),
          redirect_uri: OAUTH_REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return NextResponse.json({ error: `Google exchange failed: ${errText}` }, { status: 400 });
      }

      const tokenData = await tokenRes.json();
      if (!tokenData?.refresh_token) {
        return NextResponse.json({ error: "Google did not return a refresh_token" }, { status: 400 });
      }

      // 2. Fetch user profile
      const extra = await antigravity.postExchange(tokenData);
      const email = extra?.userInfo?.email || "antigravity-cli@local";

      // 3. Save to ADC JSON file
      const adcPayload = {
        account: email,
        client_id: ANTIGRAVITY_CONFIG.clientId,
        client_secret: ANTIGRAVITY_CONFIG.clientSecret,
        refresh_token: tokenData.refresh_token,
        type: "authorized_user",
      };

      const savedPath = await saveLocalAdcCredentials(adcPayload);

      // 4. Create or update 9Router connection
      const mapped = antigravity.mapTokens(tokenData, extra);
      const connection = await createProviderConnection({
        provider: "antigravity",
        authType: "oauth",
        ...mapped,
        providerSpecificData: extra?.projectId ? { projectId: extra.projectId, source: "cli" } : { source: "cli" },
        expiresAt: mapped.expiresIn ? new Date(Date.now() + mapped.expiresIn * 1000).toISOString() : null,
        testStatus: "active",
      });

      return NextResponse.json({
        success: true,
        path: savedPath,
        connection: {
          id: connection.id,
          email: connection.email,
          name: connection.name,
        },
      });
    }

    if (action === "logout") {
      await removeLocalAdcCredentials();

      // Also clean up any connections imported via CLI
      const connections = await getProviderConnections("antigravity");
      for (const conn of connections) {
        if (conn.providerSpecificData?.source === "cli") {
          await deleteProviderConnection(conn.id);
        }
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
