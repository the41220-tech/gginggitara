"use client";

import { useState, useEffect, useRef } from "react";

type CountdownTimerProps = {
  deadline: string;
  label?: string;
  serverNow: string;
  onTimeout?: () => void;
};

export default function CountdownTimer({ deadline, label = "집합 마감까지 남은 시간", serverNow, onTimeout }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(serverNow)) / 1000)));

  const timeoutRef = useRef(onTimeout);
  useEffect(() => {
    timeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    const clockOffset = Date.parse(serverNow) - Date.now();
    const calculateTimeLeft = () => {
      const now = Date.now() + clockOffset;
      const end = new Date(deadline).getTime();
      const difference = Math.max(0, Math.floor((end - now) / 1000));
      return difference;
    };

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        if (timeoutRef.current) timeoutRef.current();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [deadline, serverNow]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${minutes}분 ${seconds}초`;
  const formattedClock = `${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;

  return (
    <div className="countdown">
      <p className="countdown__label">{label}</p>
      <p className="countdown__time" aria-hidden="true">{formattedClock}</p>
      <p className="sr-only">{label}: {formattedTime} 남음</p>
      <span className="sr-only" role="status" aria-live="polite">
        {timeLeft === 20 || timeLeft === 10 || timeLeft === 5 ? `${label} ${timeLeft}초` : ""}
      </span>
    </div>
  );
}
