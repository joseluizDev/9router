import {
  importLocalAntigravity,
  LOCAL_ADC_NOT_FOUND,
} from "@/lib/oauth/antigravityLocal.js";
import { createProviderConnection } from "@/models";
import { NextResponse } from "next/server";

const NO_LOCAL_CREDENTIALS_MESSAGE = "No supported local ADC credentials found. Configure Google ADC or use OAuth login.";

export async function POST() {
  try {
    const tokens = await importLocalAntigravity();
    const connection = await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      ...tokens,
      providerSpecificData: tokens.projectId ? { projectId: tokens.projectId } : undefined,
      expiresAt: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
      },
    });
  } catch (error) {
    if (error?.code === LOCAL_ADC_NOT_FOUND) {
      return NextResponse.json({ error: NO_LOCAL_CREDENTIALS_MESSAGE }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to import local Antigravity credentials" }, { status: 500 });
  }
}
