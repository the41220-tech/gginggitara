"use client";

import { useCallback, useRef } from "react";

/**
 * 매칭 성사 알림 훅 — 진동 + 알림음.
 *
 * 모바일: navigator.vibrate()
 * 알림음: Web Audio API로 합성 (외부 파일 불필요)
 */
export function useMatchAlert() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playAlert = useCallback(() => {
    // 1. 진동 (모바일)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 300]);
    }

    // 2. 알림음 (Web Audio API — 외부 파일 불필요)
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;

      // 상승 멜로디: C5 → E5 → G5
      const notes = [523.25, 659.25, 783.99];
      const duration = 0.15;
      const gap = 0.05;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * (duration + gap));
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + i * (duration + gap) + duration
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * (duration + gap));
        osc.stop(ctx.currentTime + i * (duration + gap) + duration);
      });
    } catch {
      /* silent — 브라우저가 Audio API 미지원 */
    }
  }, []);

  return { playAlert };
}
