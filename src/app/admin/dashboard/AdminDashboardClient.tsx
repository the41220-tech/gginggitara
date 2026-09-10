"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { createClient } from "@/lib/supabase/client";
import DestinationManager from "./DestinationManager";
import { getDashboard, sendAdminRequest } from "./admin-api";
import type { AdminDashboardData } from "./types";
import styles from "../admin.module.css";

type Tab = "overview" | "destinations" | "queue" | "matches" | "reports";
type FunnelMetric = Readonly<{ readonly eventName: string; readonly events: number; readonly uniqueSessions: number }>;
type Metrics = Readonly<{
  totalMatches: number;
  totalPeople: number;
  statusCounts: Readonly<Record<string, number>>;
  funnel: readonly FunnelMetric[];
  health: Readonly<{
    departedMatches: number;
    resolvedMatches: number;
    offeredEntries: number;
    acceptedOfferEntries: number;
    medianMatchWaitSeconds: number | null;
  }>;
}>;

const TABS = [
  { id: "overview", label: "운영 현황" },
  { id: "destinations", label: "하차 지점" },
  { id: "queue", label: "대기열" },
  { id: "matches", label: "매칭 기록" },
  { id: "reports", label: "신고" },
] as const satisfies readonly { readonly id: Tab; readonly label: string }[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMetrics(value: unknown): Metrics | null {
  if (!isRecord(value) || !Array.isArray(value.funnel) || !isRecord(value.matching) || typeof value.matching.total_matches !== "number" || typeof value.matching.total_people !== "number" || !Array.isArray(value.matching.status_counts) || !isRecord(value.matching.health)) return null;
  const counts: Record<string, number> = {};
  for (const item of value.matching.status_counts) {
    if (!isRecord(item) || typeof item.status !== "string" || typeof item.matches !== "number") return null;
    counts[item.status] = item.matches;
  }
  const funnel: FunnelMetric[] = [];
  for (const item of value.funnel) {
    if (!isRecord(item) || typeof item.event_name !== "string" || typeof item.events !== "number" || typeof item.unique_sessions !== "number") return null;
    funnel.push({ eventName: item.event_name, events: item.events, uniqueSessions: item.unique_sessions });
  }
  const health = value.matching.health;
  if (
    typeof health.departed_matches !== "number"
    || typeof health.resolved_matches !== "number"
    || typeof health.offered_entries !== "number"
    || typeof health.accepted_offer_entries !== "number"
    || (health.median_match_wait_seconds !== null && typeof health.median_match_wait_seconds !== "number")
  ) return null;
  return {
    totalMatches: value.matching.total_matches,
    totalPeople: value.matching.total_people,
    statusCounts: counts,
    funnel,
    health: {
      departedMatches: health.departed_matches,
      resolvedMatches: health.resolved_matches,
      offeredEntries: health.offered_entries,
      acceptedOfferEntries: health.accepted_offer_entries,
      medianMatchWaitSeconds: health.median_match_wait_seconds,
    },
  };
}

function percentage(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round(numerator / denominator * 100)}%`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function funnelLabel(eventName: string): string {
  const labels: Readonly<Record<string, string>> = {
    join_started: "탑승 흐름 시작",
    drop_zone_selected: "하차 지점 선택",
    matching_started: "매칭 요청",
    offer_presented: "매칭 제안 표시",
    offer_accepted: "제안 수락 클릭",
    offer_declined: "제안 거절 클릭",
    result_viewed: "결과 화면 확인",
    account_copied: "계좌번호 복사",
  };
  return labels[eventName] ?? eventName;
}

function elapsedLabel(iso: string | null): string {
  if (!iso) return "대기 없음";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "1분 미만" : `${minutes}분`;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = { waiting: "대기", offered: "제안", matched: "집합 중", arrived: "도착", paused: "일시정지", expired: "만료", cancelled: "취소", departed: "출발", noshow: "노쇼", assembling: "집합 중", ready: "출발 가능" };
  return labels[status] ?? status;
}

export default function AdminDashboardClient() {
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState<"match" | "cleanup" | null>(null);

  const unauthorized = useCallback((message: string): void => {
    showToast(message, "error");
    router.replace("/admin");
  }, [router, showToast]);

  const load = useCallback(async (announceError = false): Promise<void> => {
    const [dashboardResult, metricsResult] = await Promise.all([
      getDashboard(),
      fetch("/api/admin/metrics", { cache: "no-store" }).then(async (response) => response.ok ? parseMetrics(await response.json()) : null).catch(() => null),
    ]);
    if (dashboardResult.kind === "unauthorized") {
      unauthorized(dashboardResult.message);
      return;
    }
    if (dashboardResult.kind === "error") {
      setError(dashboardResult.message);
      if (announceError) showToast(dashboardResult.message, "error");
    } else {
      setData(dashboardResult.data);
      setError(null);
    }
    setMetrics(metricsResult);
    setLoading(false);
  }, [showToast, unauthorized]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(true), 0);
    const interval = window.setInterval(() => void load(false), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  async function runControl(kind: "match" | "cleanup"): Promise<void> {
    setControlBusy(kind);
    const result = await sendAdminRequest(kind === "match" ? "/api/match/trigger" : "/api/cron", "POST");
    setControlBusy(null);
    if (result.kind === "unauthorized") return unauthorized(result.message);
    if (result.kind === "error") return showToast(result.message, "error");
    showToast(kind === "match" ? "매칭 엔진을 실행했습니다." : "만료 상태를 정리했습니다.", "success");
    await load(false);
  }

  async function signOut(): Promise<void> {
    await createClient().auth.signOut();
    router.replace("/admin");
  }

  if (loading && !data) return <main className={`admin-shell ${styles.dashboard}`}><div className={styles.loginShell}><LoadingSpinner message="운영 데이터를 불러오고 있습니다." /></div></main>;
  if (!data) return <main className={`admin-shell ${styles.dashboard}`}><section className={styles.panel}><StatusMessage tone="error" title="운영 데이터를 불러오지 못했습니다.">{error ?? "관리자 권한과 서버 연결을 확인해주세요."}</StatusMessage><div className={styles.rowActions}><button className="button button--primary" type="button" onClick={() => void load(true)}>다시 불러오기</button><button className="button button--secondary" type="button" onClick={() => void signOut()}>로그아웃</button></div></section></main>;

  const fillRate = metrics ? percentage(metrics.totalPeople, metrics.totalMatches * 4) : "—";
  const departureRate = metrics ? percentage(metrics.health.departedMatches, metrics.health.resolvedMatches) : "—";
  const offerAcceptanceRate = metrics ? percentage(metrics.health.acceptedOfferEntries, metrics.health.offeredEntries) : "—";

  return (
    <main className={`admin-shell ${styles.dashboard}`}>
      <header className={styles.adminHeader}>
        <div className={styles.adminBrand}><span className={styles.adminBrandMark} aria-hidden="true">G</span><div><p className={styles.eyebrow}>GGINGGITARA OPS</p><h1>운영 센터</h1></div></div>
        <div className={styles.headerActions}><button className="button button--secondary" type="button" disabled={controlBusy !== null} onClick={() => void load(true)}>새로고침</button><button className="button button--secondary" type="button" onClick={() => void signOut()}>로그아웃</button></div>
      </header>

      <nav className={styles.tabs} aria-label="관리 메뉴">{TABS.map((item) => <button key={item.id} className={styles.tab} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
      {error ? <StatusMessage tone="warning" title="자동 갱신이 지연되고 있습니다.">{error}</StatusMessage> : null}

      <div className={styles.dashboardMain}>
        {tab === "overview" ? (
          <section className={styles.overview} aria-labelledby="overview-title">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>LIVE OPERATIONS</p><h2 id="overview-title">운영 현황</h2><p>대기 병목과 팀 출발 상태를 우선 확인합니다.</p></div><div className={styles.headerActions}><button className="button button--secondary" type="button" disabled={controlBusy !== null} onClick={() => void runControl("cleanup")}>{controlBusy === "cleanup" ? "정리 중…" : "만료 상태 정리"}</button><button className="button button--primary" type="button" disabled={controlBusy !== null} onClick={() => void runControl("match")}>{controlBusy === "match" ? "실행 중…" : "매칭 엔진 실행"}</button></div></div>
            <div className={styles.metricGrid}>
              <div className={styles.metricCard}><span>현재 대기 좌석</span><strong>{data.stats.current_waiting_people}</strong><small>최장 대기 {elapsedLabel(data.stats.oldest_waiting_at)}</small></div>
              <div className={styles.metricCard}><span>오늘 생성된 팀</span><strong>{data.stats.matches_today}</strong><small>누적 {data.stats.matches}팀</small></div>
              <div className={styles.metricCard}><span>최근 7일 평균 충원율</span><strong>{fillRate}</strong><small>{metrics ? "팀당 최대 4석 기준" : "계측 API를 확인하세요"}</small></div>
              <div className={styles.metricCard}><span>최근 7일 출발률</span><strong>{departureRate}</strong><small>{metrics ? metrics.health.resolvedMatches > 0 ? `${metrics.health.departedMatches}/${metrics.health.resolvedMatches} 완료 팀` : "판정된 팀 없음" : "계측 API를 확인하세요"}</small></div>
              <div className={styles.metricCard}><span>최근 7일 제안 수락률</span><strong>{offerAcceptanceRate}</strong><small>{metrics ? metrics.health.offeredEntries > 0 ? `${metrics.health.acceptedOfferEntries}/${metrics.health.offeredEntries} 엔트리 수락` : "제안된 엔트리 없음" : "계측 API를 확인하세요"}</small></div>
              <div className={styles.metricCard}><span>최근 7일 중앙 매칭 대기</span><strong>{metrics ? duration(metrics.health.medianMatchWaitSeconds) : "—"}</strong><small>{metrics ? "대기열 등록부터 팀 생성까지" : "계측 API를 확인하세요"}</small></div>
            </div>
            <section className={styles.panel} aria-labelledby="funnel-title">
              <div className={styles.sectionHeading}><div><h2 id="funnel-title">최근 7일 사용자 흐름</h2><p>브라우저에서 수집한 의도·화면 확인 신호입니다. 운영 상태는 위의 서버 지표를 기준으로 판단하세요.</p></div></div>
              {!metrics ? <StatusMessage tone="warning" title="사용자 흐름 계측을 불러오지 못했습니다.">운영 지표는 새로고침해 다시 확인할 수 있습니다.</StatusMessage> : metrics.funnel.length === 0 ? <p className={styles.empty}>이 기간에 수집된 사용자 흐름 이벤트가 없습니다.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>단계</th><th>이벤트</th><th>고유 세션</th></tr></thead><tbody>{metrics.funnel.map((metric) => <tr key={metric.eventName}><td>{funnelLabel(metric.eventName)}</td><td>{metric.events}</td><td>{metric.uniqueSessions}</td></tr>)}</tbody></table></div>}
            </section>
            <div className={styles.panel}><div className={styles.sectionHeading}><div><h2>최근 매칭</h2><p>새로 생성된 팀 20개를 표시합니다.</p></div></div><MatchTable data={data} /></div>
          </section>
        ) : null}
        {tab === "destinations" ? <DestinationManager data={data} onChanged={() => load(false)} onUnauthorized={unauthorized} notify={showToast} /> : null}
        {tab === "queue" ? <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>실시간 대기열</h2><p>최근 20개 엔트리입니다. 세션 식별자는 화면에 노출하지 않습니다.</p></div></div><QueueTable data={data} /></section> : null}
        {tab === "matches" ? <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>매칭 기록</h2><p>팀 상태와 충원 인원을 확인합니다.</p></div></div><MatchTable data={data} /></section> : null}
        {tab === "reports" ? <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>신고</h2><p>접수 시간 순 최근 20건입니다.</p></div></div><ReportTable data={data} /></section> : null}
      </div>
    </main>
  );
}

function QueueTable({ data }: { readonly data: AdminDashboardData }) {
  if (data.queue.length === 0) return <p className={styles.empty}>표시할 대기 엔트리가 없습니다.</p>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>임시 이름</th><th>인원</th><th>경로</th><th>우선순위</th><th>상태</th><th>등록</th></tr></thead><tbody>{data.queue.map((entry) => <tr key={entry.id}><td>{entry.nickname}</td><td>{entry.party_size}명</td><td>{entry.pickup_spot_id} → {entry.drop_zone_id}</td><td>{entry.departure_mode === "fast" ? "빠른 출발" : "요금 절약"}</td><td><span className={styles.badge}>{statusLabel(entry.status)}</span></td><td>{dateTime(entry.created_at)}</td></tr>)}</tbody></table></div>;
}

function MatchTable({ data }: { readonly data: AdminDashboardData }) {
  if (data.matches.length === 0) return <p className={styles.empty}>표시할 매칭이 없습니다.</p>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>팀</th><th>경로</th><th>인원</th><th>상태</th><th>생성</th></tr></thead><tbody>{data.matches.map((match) => <tr key={match.id}><td><strong>#{match.team_number}</strong></td><td>{match.pickup_spot_id} → {match.drop_zone_id}</td><td>{match.total_party_size}/4명</td><td><span className={styles.badge}>{statusLabel(match.status)}</span></td><td>{dateTime(match.created_at)}</td></tr>)}</tbody></table></div>;
}

function ReportTable({ data }: { readonly data: AdminDashboardData }) {
  if (data.reports.length === 0) return <p className={styles.empty}>접수된 신고가 없습니다.</p>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>유형</th><th>내용</th><th>접수</th></tr></thead><tbody>{data.reports.map((report) => <tr key={report.id}><td><span className={styles.badge}>{statusLabel(report.type)}</span></td><td>{report.description ?? "상세 내용 없음"}</td><td>{dateTime(report.created_at)}</td></tr>)}</tbody></table></div>;
}
