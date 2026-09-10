import { timingSafeEqual } from "node:crypto";

export function resolveAdminEmailAllowlist(
  configuredEmails: string | undefined,
  developmentEmails: string | undefined,
  nodeEnv: string | undefined,
): ReadonlySet<string> {
  const productionEmails = configuredEmails?.trim() ?? "";
  const source = productionEmails
    || (nodeEnv === "production" ? "" : (developmentEmails?.trim() ?? ""));
  if (!source) return new Set();

  return new Set(
    source
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasBearerSecret(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(authorizationHeader);
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

export function isAuthorizedCron(request: Request): boolean {
  return hasBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET);
}

export function isSameOriginHeaders(
  origin: string | null,
  host: string | null,
  fetchSite: string | null,
): boolean {
  if (!origin || !host) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  if (
    (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
    || originUrl.username
    || originUrl.password
    || originUrl.origin !== origin
  ) {
    return false;
  }

  if (fetchSite && fetchSite !== "same-origin") return false;
  return originUrl.host === host;
}

export function isSameOriginRequest(request: Request): boolean {
  return isSameOriginHeaders(
    request.headers.get("origin"),
    request.headers.get("host"),
    request.headers.get("sec-fetch-site"),
  );
}
