import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { triggerAllMatches } from "@/lib/matching";
import { isAuthorizedCron, isSameOriginRequest } from "@/lib/request-auth";
import { sanitizeErrorMessage } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    if (!isAuthorizedCron(request)) {
      if (!isSameOriginRequest(request)) {
        return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
      }
      await requireAdminUser();
    }
    const result = await triggerAllMatches();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
