import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";

// POST /api/providers/[id]/unlock - Clear all locks, cooldowns, and error states for a connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Identify and reset all modelLock_* properties
    const lockKeys = Object.keys(connection).filter((k) => k.startsWith("modelLock_"));
    const clearLocks = Object.fromEntries(lockKeys.map((k) => [k, null]));

    const updateData = {
      ...clearLocks,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      lastErrorDetail: null,
      errorCode: null,
      validationUrl: null,
      rateLimitedUntil: null,
      backoffLevel: 0,
    };

    const updated = await updateProviderConnection(id, updateData);

    // Hide sensitive credentials
    const safeResult = { ...updated };
    delete safeResult.apiKey;
    delete safeResult.accessToken;
    delete safeResult.refreshToken;
    delete safeResult.idToken;

    return NextResponse.json({
      success: true,
      message: "Connection unlocked successfully",
      connection: safeResult,
    });
  } catch (error) {
    console.error("Error unlocking connection:", error);
    return NextResponse.json({ error: "Failed to unlock connection" }, { status: 500 });
  }
}
