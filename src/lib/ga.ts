export const GA4_HOST_SOURCES = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
] as const;

export const GA4_IMG_SOURCES = GA4_HOST_SOURCES;
export const GA4_CONNECT_SOURCES = GA4_HOST_SOURCES;

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

const GA_EVENT_PARAM_KEYS = [
  "drop_zone_id",
  "party_size",
  "preference",
  "waiting_bucket",
  "network_type",
  "latency",
  "result_code",
] as const;

type GaEventParams = Readonly<Record<string, string | number | boolean | undefined>>;

type GtagFn = (...args: unknown[]) => void;

type GaWindow = Window & {
  dataLayer?: unknown[];
  gtag?: GtagFn;
};

export function parseGaMeasurementId(value: string | undefined | null): string | null {
  const measurementId = value?.trim() ?? "";
  return GA_MEASUREMENT_ID_PATTERN.test(measurementId) ? measurementId : null;
}

export function getGaMeasurementId(): string | null {
  return parseGaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
}

export function shouldLoadGoogleAnalytics(pathname: string | null | undefined): boolean {
  return getGaMeasurementId() !== null && !isAdminPath(pathname);
}

export function isAdminPath(pathname: string | null | undefined): boolean {
  return (pathname ?? "").startsWith("/admin");
}

export function redactGaLocation(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .replace(/^\/waiting\/[^/]+/i, "/waiting/_")
    .replace(/^\/team\/[^/]+/i, "/team/_");
  return url.toString();
}

export function createGaInitScript(measurementId: string, debugMode: boolean): string {
  const parsed = parseGaMeasurementId(measurementId);
  if (!parsed) {
    throw new Error("invalid GA measurement ID");
  }
  const idLiteral = JSON.stringify(parsed).replaceAll("<", "\\u003c");
  const debugLiteral = debugMode ? ", debug_mode: true" : "";

  return [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){window.dataLayer.push(arguments);}",
    "window.gtag = gtag;",
    "gtag('consent', 'default', { ad_storage: \"denied\", ad_user_data: \"denied\", ad_personalization: \"denied\", analytics_storage: \"granted\" });",
    "gtag('js', new Date());",
    `gtag('config', ${idLiteral}, { send_page_view: false, cookie_expires: 0, cookie_flags: "Secure;SameSite=Lax", allow_google_signals: false, allow_ad_personalization_signals: false${debugLiteral} });`,
  ].join("");
}

function pickGaEventParams(params?: GaEventParams): Record<string, string | number | boolean> {
  if (!params) return {};
  const picked: Record<string, string | number | boolean> = {};
  for (const key of GA_EVENT_PARAM_KEYS) {
    const value = params[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

function currentRedactedLocation(): string | undefined {
  try {
    return redactGaLocation(window.location.href);
  } catch {
    return undefined;
  }
}

function queueGaCommand(command: unknown[]): void {
  const gaWindow = window as GaWindow;
  gaWindow.dataLayer = gaWindow.dataLayer ?? [];
  if (typeof gaWindow.gtag !== "function") {
    gaWindow.gtag = function gtag() {
      // gtag.js replays Arguments command tuples, not plain arrays.
      // eslint-disable-next-line prefer-rest-params -- GA command queue contract
      gaWindow.dataLayer?.push(arguments);
    };
  }
  gaWindow.gtag(...command);
}

export function sendGaEvent(eventName: string, params?: GaEventParams): void {
  try {
    if (typeof window === "undefined") return;
    if (!getGaMeasurementId()) return;
    if (isAdminPath(window.location.pathname)) return;

    const pageLocation = currentRedactedLocation();
    queueGaCommand([
      "event",
      eventName,
      {
        ...pickGaEventParams(params),
        ...(pageLocation ? { page_location: pageLocation } : {}),
      },
    ]);
  } catch {
    return;
  }
}

let lastPageViewLocation: string | null = null;

export function sendGaPageView(pathname: string): void {
  try {
    if (typeof window === "undefined") return;
    if (!getGaMeasurementId()) return;
    if (isAdminPath(pathname)) return;

    const pageLocation = currentRedactedLocation();
    if (!pageLocation || pageLocation === lastPageViewLocation) return;
    lastPageViewLocation = pageLocation;
    const pagePath = new URL(pageLocation).pathname;
    queueGaCommand([
      "event",
      "page_view",
      {
        page_path: pagePath,
        page_location: pageLocation,
        page_title: document.title,
      },
    ]);
  } catch {
    return;
  }
}
