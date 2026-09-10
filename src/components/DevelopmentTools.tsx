"use client";

import { useEffect } from "react";

export function DevelopmentTools() {
  useEffect(() => {
    const enabled =
      process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1";

    if (!enabled) return;

    let active = true;

    void Promise.all([import("react-grab"), import("react-scan")]).then(
      ([reactGrab, reactScan]) => {
        if (!active) return;
        reactGrab.init();
        reactScan.scan({
          enabled: true,
          showToolbar: true,
          trackUnnecessaryRenders: false,
        });
      },
      (reason: unknown) => {
        if (reason instanceof Error) {
          console.warn("React development tools could not start", {
            message: reason.message,
          });
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return null;
}
