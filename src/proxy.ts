import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import { getGaMeasurementId } from "@/lib/ga";

// ============================================================
// In-memory sliding window rate limiter
// Vercel 서버리스에서는 인스턴스 간 메모리가 공유되지 않습니다.
// 이 제한은 단일 인스턴스에서만 burst를 완화합니다.
// ============================================================

const WINDOW_MS = 60_000; // 1 minute sliding window

type RateLimitEntry = {
  timestamps: number[];
  blockedUntil?: number;
};

const ipMap = new Map<string, RateLimitEntry>();

// Endpoint-specific limits (METHOD:path_prefix → max per minute)
const LIMITS = [
  { method: "POST", pathPrefix: "/api/queue", requests: 5 },
  { method: "POST", pathPrefix: "/api/report", requests: 3 },
  { method: "PATCH", pathPrefix: "/api/match", requests: 10 },
  { method: "PATCH", pathPrefix: "/api/queue", requests: 10 },
  { method: "GET", pathPrefix: "/api", requests: 60 },
] as const;

function getLimit(method: string, pathname: string): number {
  for (const limit of LIMITS) {
    if (method === limit.method && pathname.startsWith(limit.pathPrefix)) {
      return limit.requests;
    }
  }
  return 120; // Default generous limit
}

function checkRateLimit(ip: string, method: string, pathname: string): boolean {
  const limit = getLimit(method, pathname);
  const now = Date.now();
  const key = `${ip}:${method}:${pathname.replace(/\/[0-9a-f-]{36}$/i, "/*")}`;

  let entry = ipMap.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    ipMap.set(key, entry);
  }

  // Check if IP is temporarily blocked (escalation for extreme abuse)
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return true; // rate limited
  }

  // Sliding window: remove old timestamps
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length > limit) {
    // 5× over limit → block for 5 minutes
    if (entry.timestamps.length > limit * 5) {
      entry.blockedUntil = now + 5 * 60_000;
    }
    return true; // rate limited
  }

  return false; // OK
}

// Periodic cleanup to prevent memory leak (every 5 min)
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 5 * 60_000;
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of ipMap.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
      if (
        entry.timestamps.length === 0 &&
        (!entry.blockedUntil || now > entry.blockedUntil)
      ) {
        ipMap.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  // Allow process to exit cleanly
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ============================================================
// Proxy function (Next.js 16: middleware → proxy)
// ============================================================

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    enableGoogleAnalytics: getGaMeasurementId() !== null,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  if (!pathname.startsWith("/api")) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  }

  // Extract client IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const method = request.method;

  if (checkRateLimit(ip, method, pathname)) {
    const response = NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      }
    );
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
