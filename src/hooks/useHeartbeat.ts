"use client";

import { useEffect, useRef, useCallback } from "react";
import { participantFetch } from "@/lib/client-session";

/**
 * Heartbeat 훅 — Visibility API 기반 유령 사용자 방지.
 *
 * - 탭 활성: 30초마다 heartbeat 전송
 * - 탭 비활성(hidden): heartbeat 중단 → 서버 측 60초 만료
 * - 탭 복귀(visible): 즉시 heartbeat 1회 전송 + 주기 재개
 * - 페이지 이탈: sendBeacon으로 마지막 heartbeat
 */
export function useHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(true);

  const sendHeartbeat = useCallback(async () => {
    try {
      await participantFetch("/api/queue/heartbeat", {
        method: "POST",
      });
    } catch {
      /* silent */
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    // 이미 실행 중이면 중복 방지
    if (intervalRef.current) return;
    sendHeartbeat(); // 즉시 1회
    intervalRef.current = setInterval(sendHeartbeat, 30000);
  }, [sendHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    // 초기 heartbeat 시작
    startHeartbeat();

    // Visibility API: 탭 전환 감지
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        isVisibleRef.current = false;
        stopHeartbeat();
      } else {
        isVisibleRef.current = true;
        startHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 페이지 이탈 시 sendBeacon
    const handleUnload = () => {
      navigator.sendBeacon(
        "/api/queue/heartbeat",
        new Blob([], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [startHeartbeat, stopHeartbeat]);
}
