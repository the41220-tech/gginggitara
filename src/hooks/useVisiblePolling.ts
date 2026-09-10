"use client";

import { useEffect } from "react";

export function useVisiblePolling(task: () => void, intervalMs: number): void {
  useEffect(() => {
    let interval: number | null = null;
    const stop = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
    };
    const start = () => {
      if (document.visibilityState !== "visible" || interval !== null) return;
      interval = window.setInterval(task, intervalMs);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        task();
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    const initial = window.setTimeout(task, 0);
    start();
    return () => {
      window.clearTimeout(initial);
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, task]);
}
