"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "@/app/public-flow.module.css";

type MatchAcceptOverlayProps = {
  readonly teamNumber: number;
  readonly totalPartySize: number;
  readonly pickupName: string;
  readonly dropZoneName: string;
  readonly offerExpiresAt: string;
  readonly serverNow: string;
  readonly accepted: boolean;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onExpire: () => void;
};

const OFFER_SECONDS = 20;
const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

function getFocusable(root: HTMLElement | null): readonly HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.tabIndex >= 0);
}

export default function MatchAcceptOverlay({ teamNumber, totalPartySize, pickupName, dropZoneName, offerExpiresAt, serverNow, accepted, busy, onAccept, onDecline, onExpire }: MatchAcceptOverlayProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const participateButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((Date.parse(offerExpiresAt) - Date.parse(serverNow)) / 1000)));
  const announcement = secondsLeft === 20 || secondsLeft === 10 || secondsLeft === 5 ? `매칭 제안 응답 시간이 ${secondsLeft}초 남았습니다.` : "";

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expiredRef.current = false;
    const clockOffset = Date.parse(serverNow) - Date.now();
    const calculateSeconds = () => Math.max(0, Math.ceil((Date.parse(offerExpiresAt) - (Date.now() + clockOffset)) / 1000));
    const timer = window.setInterval(() => {
      const next = calculateSeconds();
      setSecondsLeft(next);
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [offerExpiresAt, serverNow]);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const participateButton = participateButtonRef.current;
      (participateButton && !participateButton.disabled ? participateButton : panelRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={panelRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <span className={styles.eyebrow}>매칭 제안 · 팀 {teamNumber}</span>
        <h2 id={titleId} className="dialog__title">{totalPartySize}명이 모였어요</h2>
        <p id={descriptionId} className="dialog__description">20초 안에 모두 참여하면 팀이 확정됩니다. 이번 팀 제안을 거절하면 이 제안이 해산되고, 본인은 대기에서 빠지며 다른 일행은 다시 대기로 돌아갑니다. 응답하지 않으면 본인의 대기가 잠시 멈춰요.</p>
        <div className={styles.offerMeta}>
          <div><span>승차 지점</span><strong>{pickupName}</strong></div>
          <div><span>하차 지점</span><strong>{dropZoneName}</strong></div>
        </div>
        <div className={styles.offerProgress} aria-hidden="true"><div className={styles.offerProgressBar} style={{ transform: `scaleX(${Math.min(1, secondsLeft / OFFER_SECONDS)})` }} /></div>
        <p className={styles.meta}>{accepted ? "참여 응답을 보냈어요. 다른 팀원의 응답을 기다리는 중입니다." : `응답 마감까지 ${secondsLeft}초`}</p>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        <div className="dialog__actions">
          <button className="button button--quiet-danger" type="button" disabled={busy || secondsLeft === 0} onClick={onDecline}>이번 팀 제안 거절</button>
          <button ref={participateButtonRef} className="button button--primary" type="button" disabled={busy || accepted || secondsLeft === 0} onClick={onAccept}>{busy ? "응답 전송 중…" : accepted ? "참여 응답 완료" : "팀 참여"}</button>
        </div>
      </div>
    </div>
  );
}
