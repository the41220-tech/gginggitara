import Script from "next/script";
import { headers } from "next/headers";
import { GoogleAnalyticsPageViews } from "@/components/GoogleAnalyticsPageViews";
import { createGaInitScript, getGaMeasurementId, shouldLoadGoogleAnalytics } from "@/lib/ga";

export async function GoogleAnalytics() {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-pathname");
  const measurementId = getGaMeasurementId();
  if (!measurementId || !shouldLoadGoogleAnalytics(pathname)) return null;

  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const debugMode = process.env.NEXT_PUBLIC_GA_DEBUG === "1";

  return (
    <>
      <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
        {createGaInitScript(measurementId, debugMode)}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <GoogleAnalyticsPageViews />
    </>
  );
}
