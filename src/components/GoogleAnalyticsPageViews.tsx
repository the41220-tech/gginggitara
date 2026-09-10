"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { sendGaPageView } from "@/lib/ga";

export function GoogleAnalyticsPageViews() {
  const pathname = usePathname();

  useEffect(() => {
    sendGaPageView(pathname);
  }, [pathname]);

  return null;
}
