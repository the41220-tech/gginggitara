"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import SettlementSection from "@/components/SettlementSection";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { trackProductEvent } from "@/lib/analytics";
import { participantFetch } from "@/lib/client-session";
import styles from "@/app/public-flow.module.css";

type ResultStatus = "waiting" | "offered" | "matched" | "arrived" | "paused" | "expired" | "cancelled" | "departed" | "noshow";
type ResultEntry = {
  readonly id: string;
  readonly status: ResultStatus;
  readonly party_size: number;
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly departure_mode: "fast" | "cheap";
  readonly match_id: string | null;
  readonly pickupName: string;
  readonly dropZoneName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

function apiMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") return value.error;
  return isRecord(value.error) && typeof value.error.message === "string" ? value.error.message : fallback;
}

function parseEntry(value: unknown): ResultEntry | null {
  if (!isRecord(value)) return null;
  const statuses: readonly string[] = ["waiting", "offered", "matched", "arrived", "paused", "expired", "cancelled", "departed", "noshow"];
  if (typeof value.id !== "string" || typeof value.status !== "string" || !statuses.includes(value.status) || typeof value.party_size !== "number" || typeof value.pickup_spot_id !== "string" || typeof value.drop_zone_id !== "string" || (value.departure_mode !== "fast" && value.departure_mode !== "cheap") || (value.match_id !== null && typeof value.match_id !== "string")) return null;
  const pickup = relation(value.pickup);
  const dropZone = relation(value.drop_zone);
  return {
    id: value.id,
    status: value.status as ResultStatus,
    party_size: value.party_size,
    pickup_spot_id: value.pickup_spot_id,
    drop_zone_id: value.drop_zone_id,
    departure_mode: value.departure_mode,
    match_id: value.match_id,
    pickupName: pickup && typeof pickup.name === "string" ? pickup.name : "선택한 승차 지점",
    dropZoneName: dropZone && typeof dropZone.name === "string" ? dropZone.name : "선택한 하차 지점",
  };
}

export default function ResultPage() {
  const router = useRouter();
  const [entry, setEntry] = useState<ResultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const trackedRef = useRef<string | null>(null);

  const loadResult = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await participantFetch("/api/queue", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (response.status === 401) {
        setEntry(null);
        setError(null);
        return;
      }
      if (!response.ok) throw new Error(apiMessage(payload, "진행 상태를 확인하지 못했어요."));
      const nextEntry = payload === null ? null : parseEntry(payload);
      if (payload !== null && !nextEntry) throw new Error("진행 상태 응답 형식을 확인하지 못했어요.");
      setEntry(nextEntry);
      setError(null);
      const resultCode = (nextEntry?.status ?? "no_session").toUpperCase();
      if (trackedRef.current !== resultCode) {
        trackedRef.current = resultCode;
        trackProductEvent({ eventName: "result_viewed", properties: { result_code: resultCode, drop_zone_id: nextEntry?.drop_zone_id } });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "네트워크 연결을 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadResult(), 0);
    return () => window.clearTimeout(timer);
  }, [loadResult]);

  function retryWithSelections(): void {
    if (entry) sessionStorage.setItem("kkinggitaja_selections", JSON.stringify({ partySize: entry.party_size, pickupSpot: entry.pickup_spot_id, dropZone: entry.drop_zone_id, departureMode: entry.departure_mode }));
    router.push("/join");
  }

  if (loading) return <main className={`public-shell ${styles.page}`}><div className={styles.loadingPanel}><LoadingSpinner message="진행 결과를 확인하고 있어요." /></div></main>;

  const activeStatus = entry?.status === "waiting" || entry?.status === "offered" || entry?.status === "matched" || entry?.status === "arrived" || entry?.status === "paused";
  const activeHref = entry?.status === "matched" || entry?.status === "arrived" ? entry.match_id ? `/team/${entry.match_id}` : `/waiting/${entry.id}` : entry ? `/waiting/${entry.id}` : "/join";

  return (
    <main className={`public-shell ${styles.page}`}>
      <div className={styles.topbar}><Link className={styles.brand} href="/join" aria-label="낑기타자 처음으로"><span className={styles.brandMark} aria-hidden="true" /><span>낑기타자</span></Link><span className={styles.serviceChip}>이용 결과</span></div>
      <div className={`${styles.main} ${styles.narrow}`}>
        {error ? (
          <section className={`surface-card ${styles.emptyState}`}><StatusMessage tone="error" title="결과를 확인하지 못했어요.">{error}</StatusMessage><div className={styles.actions}><button className="button button--primary" type="button" onClick={() => void loadResult()}>결과 다시 확인</button><Link className="button button--secondary" href="/join">처음으로</Link></div></section>
        ) : entry?.status === "departed" ? (
          <>
            <header className={styles.hero}><span className={styles.eyebrow}>출발 완료</span><h1>팀 출발을 완료했어요.</h1><p>{entry.pickupName}에서 {entry.dropZoneName} 방향으로 출발했습니다. 실제 결제자가 아래에서 정산 정보를 전달할 수 있어요.</p></header>
            {entry.match_id ? <SettlementSection matchId={entry.match_id} /> : <StatusMessage tone="warning" title="정산할 팀을 확인하지 못했어요.">운영자에게 팀 번호와 함께 문의해주세요.</StatusMessage>}
            <button className="button button--secondary" type="button" onClick={retryWithSelections}>새 매칭 시작</button>
          </>
        ) : entry?.status === "expired" ? (
          <section className={`surface-card ${styles.emptyState}`}><span className={styles.eyebrow}>대기 종료</span><h1>이번에는 팀을 찾지 못했어요.</h1><p className={styles.lead}>{entry.dropZoneName} 방향 대기가 3분 동안 성사되지 않았습니다. 같은 조건으로 바로 다시 시도하거나 하차 지점을 바꿀 수 있어요.</p><div className={styles.actions}><button className="button button--primary" type="button" onClick={retryWithSelections}>같은 조건으로 다시 시도</button><Link className="button button--secondary" href="/join">하차 지점 변경</Link></div></section>
        ) : entry?.status === "cancelled" ? (
          <section className={`surface-card ${styles.emptyState}`}><span className={styles.eyebrow}>대기 취소</span><h1>대기를 종료했어요.</h1><p className={styles.lead}>자동으로 다시 매칭되지 않습니다. 필요할 때 새 대기를 시작해주세요.</p><button className="button button--primary" type="button" onClick={retryWithSelections}>새 매칭 시작</button></section>
        ) : entry?.status === "noshow" ? (
          <section className={`surface-card ${styles.emptyState}`}><StatusMessage tone="warning" title="도착 확인이 누락됐어요.">집합 마감 전 도착 확인이 없어 이번 팀에서 제외됐습니다. 반복될 경우 30분 동안 이용이 제한될 수 있어요.</StatusMessage><button className="button button--primary" type="button" onClick={retryWithSelections}>처음으로 돌아가기</button></section>
        ) : activeStatus ? (
          <section className={`surface-card ${styles.emptyState}`}><StatusMessage tone="info" title="진행 중인 매칭이 있어요.">{entry?.status === "paused" ? "놓친 제안 이후 대기가 잠시 멈췄습니다. 대기 화면에서 다시 시작할 수 있어요." : "정확한 최신 상태를 진행 화면에서 확인해주세요."}</StatusMessage><Link className="button button--primary" href={activeHref}>진행 화면으로 돌아가기</Link></section>
        ) : (
          <section className={`surface-card ${styles.emptyState}`}><span className={styles.eyebrow}>진행 중인 매칭 없음</span><h1>새 매칭을 시작해볼까요?</h1><p className={styles.lead}>하차 지점과 우선순위를 고르면 새 팀을 찾을 수 있어요.</p><Link className="button button--primary" href="/join">매칭 시작</Link></section>
        )}
      </div>
    </main>
  );
}
