"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CountdownTimer from "@/components/CountdownTimer";
import LoadingSpinner from "@/components/LoadingSpinner";
import MatchAcceptOverlay from "@/components/MatchAcceptOverlay";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { apiMessage, isRecord, relation } from "@/lib/api-response";
import { trackProductEvent } from "@/lib/analytics";
import { advanceParticipantMatching } from "@/lib/client-matching";
import { participantFetch } from "@/lib/client-session";
import { useMatchAlert } from "@/hooks/useMatchAlert";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import styles from "@/app/public-flow.module.css";

type QueueStatus = "waiting" | "offered" | "matched" | "arrived" | "paused" | "expired" | "cancelled" | "departed" | "noshow";
type RouteLabel = { readonly name: string; readonly location_desc?: string; readonly description?: string | null; readonly walk_minutes?: number };
type OfferMatch = {
  readonly id: string;
  readonly team_number: number;
  readonly total_party_size: number;
  readonly offer_expires_at: string;
  readonly assembly_deadline: string;
  readonly status: string;
};
type QueueView = {
  readonly id: string;
  readonly nickname: string;
  readonly party_size: number;
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly departure_mode: "fast" | "cheap";
  readonly status: QueueStatus;
  readonly match_id: string | null;
  readonly queue_deadline_at: string;
  readonly offer_accepted_at: string | null;
  readonly offer_version: number;
  readonly server_now: string;
  readonly pickup: RouteLabel | null;
  readonly dropZone: RouteLabel | null;
  readonly match: OfferMatch | null;
};

function routeLabel(value: unknown): RouteLabel | null {
  const item = relation(value);
  if (!item || typeof item.name !== "string") return null;
  return {
    name: item.name,
    location_desc: typeof item.location_desc === "string" ? item.location_desc : undefined,
    description: item.description === null || typeof item.description === "string" ? item.description : undefined,
    walk_minutes: typeof item.walk_minutes === "number" ? item.walk_minutes : undefined,
  };
}

function offerMatch(value: unknown): OfferMatch | null {
  const item = relation(value);
  if (!item || typeof item.id !== "string" || typeof item.team_number !== "number" || typeof item.total_party_size !== "number" || typeof item.offer_expires_at !== "string" || typeof item.assembly_deadline !== "string" || typeof item.status !== "string") return null;
  return { id: item.id, team_number: item.team_number, total_party_size: item.total_party_size, offer_expires_at: item.offer_expires_at, assembly_deadline: item.assembly_deadline, status: item.status };
}

function queueView(value: unknown): QueueView | null {
  if (!isRecord(value)) return null;
  const validStatuses: readonly string[] = ["waiting", "offered", "matched", "arrived", "paused", "expired", "cancelled", "departed", "noshow"];
  if (typeof value.id !== "string" || typeof value.nickname !== "string" || typeof value.party_size !== "number" || typeof value.pickup_spot_id !== "string" || typeof value.drop_zone_id !== "string" || (value.departure_mode !== "fast" && value.departure_mode !== "cheap") || typeof value.status !== "string" || !validStatuses.includes(value.status) || (value.match_id !== null && typeof value.match_id !== "string") || typeof value.queue_deadline_at !== "string" || (value.offer_accepted_at !== null && typeof value.offer_accepted_at !== "string") || typeof value.offer_version !== "number" || typeof value.server_now !== "string") return null;
  return {
    id: value.id,
    nickname: value.nickname,
    party_size: value.party_size,
    pickup_spot_id: value.pickup_spot_id,
    drop_zone_id: value.drop_zone_id,
    departure_mode: value.departure_mode,
    status: value.status as QueueStatus,
    match_id: value.match_id,
    queue_deadline_at: value.queue_deadline_at,
    offer_accepted_at: value.offer_accepted_at,
    offer_version: value.offer_version,
    server_now: value.server_now,
    pickup: routeLabel(value.pickup),
    dropZone: routeLabel(value.drop_zone),
    match: offerMatch(value.match),
  };
}

export default function WaitingPage({ params }: { readonly params: Promise<{ readonly entryId: string }> }) {
  const { entryId } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const { playAlert } = useMatchAlert();
  const [entry, setEntry] = useState<QueueView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherPeople, setOtherPeople] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [busyAction, setBusyAction] = useState<"accept" | "decline" | "cancel" | "resume" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const presentedOfferRef = useRef<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const countSequenceRef = useRef(0);

  const refresh = useCallback(async (announceError = false): Promise<void> => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const response = await participantFetch("/api/queue", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (sequence !== refreshSequenceRef.current) return;
      if (!response.ok) throw new Error(apiMessage(payload, "대기 상태를 확인하지 못했어요."));
      if (payload === null) {
        router.replace("/result");
        return;
      }
      const nextEntry = queueView(payload);
      if (!nextEntry) throw new Error("대기 상태 응답 형식을 확인하지 못했어요.");
      if (nextEntry.id !== entryId) {
        router.replace(`/waiting/${nextEntry.id}`);
        return;
      }
      setEntry(nextEntry);
      setError(null);
      setLastUpdatedAt(new Date());
      setLoading(false);

      if (nextEntry.status === "offered" && nextEntry.match) {
        const offerKey = `${nextEntry.match.id}:${nextEntry.offer_version}`;
        if (presentedOfferRef.current !== offerKey) {
          presentedOfferRef.current = offerKey;
          trackProductEvent({ eventName: "offer_presented", properties: { drop_zone_id: nextEntry.drop_zone_id, party_size: Math.min(3, Math.max(1, nextEntry.party_size)) as 1 | 2 | 3, preference: nextEntry.departure_mode } });
          playAlert();
        }
      }

      if ((nextEntry.status === "matched" || nextEntry.status === "arrived") && nextEntry.match_id) router.replace(`/team/${nextEntry.match_id}`);
      if (["expired", "cancelled", "departed", "noshow"].includes(nextEntry.status)) router.replace("/result");
    } catch (caught) {
      if (sequence !== refreshSequenceRef.current) return;
      const message = caught instanceof Error ? caught.message : "네트워크 연결을 확인해주세요.";
      setError(message);
      setLoading(false);
      if (announceError) showToast(message, "error");
    }
  }, [entryId, playAlert, router, showToast]);

  const refreshCount = useCallback(async (current: QueueView): Promise<void> => {
    const sequence = ++countSequenceRef.current;
    try {
      const response = await participantFetch(`/api/queue/count?pickup_spot_id=${encodeURIComponent(current.pickup_spot_id)}&drop_zone_id=${encodeURIComponent(current.drop_zone_id)}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (sequence !== countSequenceRef.current) return;
      if (!response.ok || !isRecord(payload) || typeof payload.people !== "number") throw new Error("count unavailable");
      setOtherPeople(payload.people);
    } catch {
      if (sequence !== countSequenceRef.current) return;
      setOtherPeople(null);
    }
  }, []);

  const pollQueue = useCallback(() => void refresh(false), [refresh]);
  useVisiblePolling(pollQueue, 2_500);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); pollQueue(); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      refreshSequenceRef.current += 1;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [pollQueue]);

  const pollCount = useCallback(() => {
    if (entry?.status === "waiting") void refreshCount(entry);
  }, [entry, refreshCount]);
  useVisiblePolling(pollCount, 7_500);

  const advanceAndRefresh = useCallback(async (): Promise<void> => {
    try {
      const nextRoute = await advanceParticipantMatching();
      if (nextRoute && nextRoute !== `/waiting/${entryId}`) {
        router.replace(nextRoute);
        return;
      }
      await refresh(false);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "매칭 상태를 갱신하지 못했어요.", "error");
      await refresh(false);
    }
  }, [entryId, refresh, router, showToast]);

  async function transition(action: "accept" | "decline" | "cancel" | "resume"): Promise<void> {
    if (!entry) return;
    setBusyAction(action);
    try {
      const response = await participantFetch(`/api/queue/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, offer_version: entry.offer_version }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload, "상태가 바뀌었어요. 다시 확인해주세요."));
      if (action === "accept") {
        trackProductEvent({ eventName: "offer_accepted", properties: { drop_zone_id: entry.drop_zone_id } });
        showToast("팀 참여 응답을 보냈어요.", "success");
        if (isRecord(payload) && payload.status === "matched" && typeof payload.match_id === "string") router.replace(`/team/${payload.match_id}`);
        else await refresh(false);
      } else if (action === "decline") {
        trackProductEvent({ eventName: "offer_declined", properties: { drop_zone_id: entry.drop_zone_id } });
        router.replace("/result");
      } else if (action === "cancel") {
        router.replace("/result");
      } else {
        showToast("대기를 다시 시작했어요.", "success");
        await refresh(false);
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "요청을 처리하지 못했어요.", "error");
      await refresh(false);
    } finally {
      setBusyAction(null);
      setCancelOpen(false);
    }
  }

  if (loading && !entry) return <main className={`public-shell ${styles.page}`}><div className={styles.loadingPanel}><LoadingSpinner message="대기 상태를 불러오고 있어요." /></div></main>;
  if (!entry) return (
    <main className={`public-shell ${styles.page}`}><div className={`${styles.main} ${styles.narrow}`}><section className={`surface-card ${styles.emptyState}`}><StatusMessage tone="error" title="대기 상태를 확인하지 못했어요.">{error ?? "잠시 후 다시 시도해주세요."}</StatusMessage><div className={styles.actions}><button className="button button--primary" type="button" onClick={() => void refresh(true)}>상태 다시 확인</button><Link className="button button--secondary" href="/join">처음으로</Link></div></section></div></main>
  );

  const pickupName = entry.pickup?.name ?? "선택한 승차 지점";
  const dropZoneName = entry.dropZone?.name ?? "선택한 하차 지점";
  const hasActiveOffer = entry.status === "offered" && entry.match !== null;
  const visiblePeople = Math.min(4, entry.party_size + (otherPeople ?? 0));
  const connectionState = !online ? "offline" : error ? "stale" : "live";

  return (
    <main className={`public-shell ${styles.page}`}>
      <div className={styles.topbar}><Link className={styles.brand} href="/join" aria-label="낑기타자 처음으로"><span className={styles.brandMark} aria-hidden="true" /><span>낑기타자</span></Link><span className={styles.serviceChip}>매칭 대기</span></div>
      <div className={`${styles.main} ${styles.narrow}`}>
        <div className={styles.timeline} aria-label="진행 단계"><span className={styles.timelineStep} data-active="true">1. 매칭 대기</span><span className={styles.timelineStep}>2. 제안 확인</span><span className={styles.timelineStep}>3. 승차 집합</span></div>
        <header className={styles.hero}><span className={styles.eyebrow}>{pickupName} 출발</span><h1 className={styles.routeTitle}>{dropZoneName} 방향 팀을 <span className={styles.noWrap}>찾고 있어요.</span></h1><p>대기는 서버에서 최대 3분간 유지됩니다. 20초 제안을 놓치지 않으려면 이 화면을 열어두세요.</p></header>

        {entry.status === "paused" ? (
          <section className={styles.section}><StatusMessage tone="warning" title="매칭 제안 응답을 놓쳤어요.">자동으로 다른 팀에 들어가지 않도록 대기를 잠시 멈췄습니다.</StatusMessage><button className="button button--primary" type="button" disabled={busyAction !== null} onClick={() => void transition("resume")}>{busyAction === "resume" ? "다시 시작 중…" : "같은 조건으로 대기 재개"}</button></section>
        ) : (
          <>
            <section className={styles.section} aria-labelledby="wait-time-title"><div className={styles.sectionHeader}><div><h2 id="wait-time-title">남은 대기 시간</h2><p>기한이 되면 서버가 현재 인원으로 가능한 팀을 확인합니다.</p></div></div><CountdownTimer deadline={entry.queue_deadline_at} serverNow={entry.server_now} label="대기 종료까지" onTimeout={() => void advanceAndRefresh()} /></section>
            <section className={styles.section} aria-labelledby="seat-title">
              <div className={styles.sectionHeader}><div><h2 id="seat-title">현재 좌석</h2><p>내 일행은 초록색, 함께 기다리는 좌석은 파란색으로 표시합니다.</p></div><strong>{visiblePeople}/4명</strong></div>
              <div className={styles.seatMeter} aria-label={`최대 4석 중 ${visiblePeople}석 예상`}>
                {Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.seat} data-filled={index < visiblePeople} data-mine={index < entry.party_size} />)}
              </div>
              <div className={styles.metricRow}><span className={styles.meta}>내 일행 {entry.party_size}명</span><strong>{otherPeople === null ? "다른 대기자 확인 중" : otherPeople > 0 ? `같은 경로 ${otherPeople}명 대기` : "아직 같은 경로 대기자 없음"}</strong></div>
            </section>
            <section className={styles.section}><div className={styles.sectionHeader}><div><h2>{entry.departure_mode === "fast" ? "빠른 출발 우선" : "요금 절약 우선"}</h2><p>{entry.departure_mode === "fast" ? "서로 다른 2팀 이상이고 모든 일행이 빠른 출발을 선택한 2~3명 팀이면 바로 제안합니다." : "4명을 우선 기다리고, 3분 뒤 2~3명으로 가능한 팀을 제안합니다."}</p></div></div></section>
          </>
        )}

        <div className={styles.inlineStatus} role="status"><span className={styles.connectionDot} data-state={connectionState} aria-hidden="true" /><span>{!online ? "인터넷 연결이 끊겼어요. 연결되면 자동으로 다시 확인합니다." : error ? "마지막 상태를 표시 중이에요. 서버 연결을 다시 확인하고 있습니다." : `서버와 연결됨${lastUpdatedAt ? ` · ${lastUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 갱신` : ""}`}</span></div>
        {!hasActiveOffer ? <button className="button button--quiet-danger" type="button" disabled={busyAction !== null} onClick={() => setCancelOpen(true)}>대기 취소</button> : null}
      </div>

      {entry.status === "offered" && entry.match ? <MatchAcceptOverlay key={`${entry.match.id}:${entry.offer_version}`} teamNumber={entry.match.team_number} totalPartySize={entry.match.total_party_size} pickupName={pickupName} dropZoneName={dropZoneName} offerExpiresAt={entry.match.offer_expires_at} serverNow={entry.server_now} accepted={entry.offer_accepted_at !== null} busy={busyAction !== null} onAccept={() => void transition("accept")} onDecline={() => void transition("decline")} onExpire={() => void advanceAndRefresh()} /> : null}
      <ConfirmDialog open={cancelOpen} title="대기를 취소할까요?" description="현재 순서가 사라지고, 다시 참여하면 새 대기열로 등록됩니다." confirmLabel="대기 취소" tone="danger" busy={busyAction === "cancel"} onConfirm={() => void transition("cancel")} onClose={() => setCancelOpen(false)} />
    </main>
  );
}
