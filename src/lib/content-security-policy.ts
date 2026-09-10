import { GA4_CONNECT_SOURCES, GA4_IMG_SOURCES } from "./ga";

export type ContentSecurityPolicyInput = Readonly<{
  nonce: string;
  isDevelopment: boolean;
  supabaseUrl?: string;
  enableGoogleAnalytics?: boolean;
}>;

export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  const supabaseUrl = input.supabaseUrl?.trim();
  const supabaseWebSocketUrl = supabaseUrl?.replace(/^http/, "ws");
  const extraImageSources = [
    supabaseUrl,
    ...(input.enableGoogleAnalytics ? GA4_IMG_SOURCES : []),
  ]
    .filter(Boolean)
    .map((source) => ` ${source}`)
    .join("");
  const extraConnectSources = [
    supabaseUrl,
    supabaseWebSocketUrl,
    ...(input.enableGoogleAnalytics ? GA4_CONNECT_SOURCES : []),
  ]
    .filter(Boolean)
    .map((source) => ` ${source}`)
    .join("");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${input.isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extraImageSources}`,
    "font-src 'self' data:",
    `connect-src 'self'${extraConnectSources}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(input.isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
