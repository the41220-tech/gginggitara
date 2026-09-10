import { NextRequest, NextResponse } from "next/server";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { cleanupAndReMatch } from "@/lib/matching";
import { isAuthorizedCron, isSameOriginRequest } from "@/lib/request-auth";
import { sanitizeErrorMessage } from "@/lib/validation";

async function runCleanup() {
  const result = await cleanupAndReMatch();
  return NextResponse.json(
    { success: true, ...result },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return await runCleanup();
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    await requireAdminUser();
    return await runCleanup();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
