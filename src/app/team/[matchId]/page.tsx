"use client";

import { use, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CountdownTimer from "@/components/CountdownTimer";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { trackProductEvent } from "@/lib/analytics";
import { participantFetch } from "@/lib/client-session";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import styles from "@/app/public-flow.module.css";

type MemberStatus = "matched" | "arrived" | "noshow" | "departed";
type TeamMember = { readonly id: string; readonly nickname: string; readonly party_size: number; readonly status: MemberStatus };
type RouteLabel = { readonly name: string; readonly location_desc?: string; readonly description?: string | null; readonly walk_minutes?: number };
type MatchView = {
  readonly id: string;
  readonly team_number: number;
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly total_party_size: number;
  readonly assembly_deadline: string;
  readonly status: "offered" | "assembling" | "ready" | "departed" | "cancelled";
  readonly server_now: string;
  readonly viewer_entry_id: string;
  readonly pickup: RouteLabel | null;
  readonly dropZone: RouteLabel | null;
  readonly members: readonly TeamMember[];
};
type ReportType = "noshow" | "wrong_count" | "bad_behavior" | "other";

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

function routeLabel(value: unknown): RouteLabel | null {
  const item = relation(value);
  if (!item || typeof item.name !== "string") return null;
  return { name: item.name, location_desc: typeof item.location_desc === "string" ? item.location_desc : undefined, description: item.description === null || typeof item.description === "string" ? item.description : undefined, walk_minutes: typeof item.walk_minutes === "number" ? item.walk_minutes : undefined };
}

function parseMembers(value: unknown): readonly TeamMember[] | null {
  if (!Array.isArray(value)) return null;
  const members: TeamMember[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.nickname !== "string" || typeof item.party_size !== "number" || (item.status !== "matched" && item.status !== "arrived" && item.status !== "noshow" && item.status !== "departed")) return null;
    members.push({ id: item.id, nickname: item.nickname, party_size: item.party_size, status: item.status });
  }
  return members;
}

function matchView(value: unknown): MatchView | null {
  if (!isRecord(value)) return null;
  const members = parseMembers(value.members);
  if (!members || typeof value.id !== "string" || typeof value.team_number !== "number" || typeof value.pickup_spot_id !== "string" || typeof value.drop_zone_id !== "string" || typeof value.total_party_size !== "number" || typeof value.assembly_deadline !== "string" || (value.status !== "offered" && value.status !== "assembling" && value.status !== "ready" && value.status !== "departed" && value.status !== "cancelled") || typeof value.server_now !== "string" || typeof value.viewer_entry_id !== "string") return null;
  return { id: value.id, team_number: value.team_number, pickup_spot_id: value.pickup_spot_id, drop_zone_id: value.drop_zone_id, total_party_size: value.total_party_size, assembly_deadline: value.assembly_deadline, status: value.status, server_now: value.server_now, viewer_entry_id: value.viewer_entry_id, pickup: routeLabel(value.pickup), dropZone: routeLabel(value.drop_zone), members };
}

function memberStatus(member: TeamMember): { readonly label: string; readonly tone: "success" | "warning" | "neutral" } {
  if (member.status === "arrived" || member.status === "departed") return { label: member.status === "departed" ? "출발" : "도착", tone: "success" };
  if (member.status === "noshow") return { label: "집합 제외", tone: "warning" };
  return { label: "이동 중", tone: "neutral" };
}

export default function TeamPage({ params }: { readonly params: Promise<{ readonly matchId: string }> }) {
  const { matchId } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"arrive" | "depart" | "report" | null>(null);
  const [departOpen, setDepartOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>("noshow");
  const [reportDescription, setReportDescription] = useState("");
  const viewedRef = useRef(false);
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async (announceError = false): Promise<void> => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const response = await participantFetch(`/api/match/${encodeURIComponent(matchId)}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (sequence !== refreshSequenceRef.current) return;
      if (!response.ok) throw new Error(apiMessage(payload, response.status === 404 ? "팀을 찾을 수 없어요." : response.status === 403 ? "이 팀에 참여한 세션이 아니에요." : "팀 상태를 불러오지 못했어요."));
      const nextMatch = matchView(payload);
      if (!nextMatch) throw new Error("팀 상태 응답 형식을 확인하지 못했어요.");
      setMatch(nextMatch);
      setError(null);
      setLoading(false);
      if (!viewedRef.current) {
        viewedRef.current = true;
        trackProductEvent({ eventName: "team_assembled", properties: { drop_zone_id: nextMatch.drop_zone_id } });
      }
      const viewer = nextMatch.members.find((member) => member.id === nextMatch.viewer_entry_id);
      if (nextMatch.status === "departed" || nextMatch.status === "cancelled" || viewer?.status === "noshow") router.replace("/result");
    } catch (caught) {
      if (sequence !== refreshSequenceRef.current) return;
      const message = caught instanceof Error ? caught.message : "네트워크 연결을 확인해주세요.";
      setError(message);
      setLoading(false);
      if (announceError) showToast(message, "error");
    }
  }, [matchId, router, showToast]);

  const pollMatch = useCallback(() => void refresh(false), [refresh]);
  useVisiblePolling(pollMatch, 2_500);

  useEffect(() => () => {
    refreshSequenceRef.current += 1;
  }, []);

  async function transition(action: "arrive" | "depart"): Promise<void> {
    setBusy(action);
    try {
      const response = await participantFetch(`/api/match/${encodeURIComponent(matchId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload, "팀 상태가 바뀌었어요. 다시 확인해주세요."));
      if (action === "arrive") {
        trackProductEvent({ eventName: "arrival_marked", properties: match ? { drop_zone_id: match.drop_zone_id } : undefined });
        showToast("승차 지점 도착을 확인했어요.", "success");
        await refresh(false);
      } else {
        trackProductEvent({ eventName: "departed", properties: match ? { drop_zone_id: match.drop_zone_id } : undefined });
        router.replace("/result");
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "요청을 처리하지 못했어요.", "error");
      await refresh(false);
    } finally {
      setBusy(null);
      setDepartOpen(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("report");
    try {
      const response = await participantFetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match_id: matchId, type: reportType, description: reportDescription.trim() || null }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload, "신고를 접수하지 못했어요."));
      showToast("신고를 접수했어요. 운영자가 확인합니다.", "success");
      setReportOpen(false);
      setReportDescription("");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "신고를 접수하지 못했어요.", "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !match) return <main className={`public-shell ${styles.page}`}><div className={styles.loadingPanel}><LoadingSpinner message="팀 정보를 불러오고 있어요." /></div></main>;
  if (!match) return <main className={`public-shell ${styles.page}`}><div className={`${styles.main} ${styles.narrow}`}><section className={`surface-card ${styles.emptyState}`}><StatusMessage tone="error" title="팀 정보를 확인하지 못했어요.">{error ?? "이 링크가 올바른지 확인해주세요."}</StatusMessage><div className={styles.actions}><button className="button button--primary" type="button" onClick={() => void refresh(true)}>팀 다시 확인</button><Link className="button button--secondary" href="/join">처음으로</Link></div></section></div></main>;

  const viewer = match.members.find((member) => member.id === match.viewer_entry_id) ?? null;
  const arrivedPeople = match.members.filter((member) => member.status === "arrived" || member.status === "departed").reduce((sum, member) => sum + member.party_size, 0);
  const excludedPeople = match.members.filter((member) => member.status === "noshow").reduce((sum, member) => sum + member.party_size, 0);
  const pickupName = match.pickup?.name ?? "선택한 승차 지점";
  const dropZoneName = match.dropZone?.name ?? "선택한 하차 지점";

  return (
    <main className={`public-shell ${styles.page}`}>
      <div className={styles.topbar}><Link className={styles.brand} href="/join" aria-label="낑기타자 처음으로"><span className={styles.brandMark} aria-hidden="true" /><span>낑기타자</span></Link><span className={styles.serviceChip}>팀 확정</span></div>
      <div className={`${styles.main} ${styles.narrow}`}>
        <div className={styles.timeline} aria-label="진행 단계"><span className={styles.timelineStep} data-active="true">1. 매칭 완료</span><span className={styles.timelineStep} data-active="true">2. 승차 집합</span><span className={styles.timelineStep}>3. 출발</span></div>
        <header className={styles.hero}><span className={styles.eyebrow}>{dropZoneName} 방향 · 총 {match.total_party_size}명</span><div className={styles.teamNumber}><span>팀</span><strong>{match.team_number}</strong></div><h1 className={styles.routeTitle}>{pickupName}에서 팀 번호를 확인하세요.</h1><p>{match.pickup?.location_desc ?? "선택한 승차 지점에서 같은 팀 번호를 찾아주세요."}</p></header>

        <section className={styles.section} aria-labelledby="assembly-time"><div className={styles.sectionHeader}><div><h2 id="assembly-time">집합 마감</h2><p>마감 뒤에는 도착한 서로 다른 일행이 2팀 이상일 때만 출발할 수 있어요.</p></div></div><CountdownTimer deadline={match.assembly_deadline} serverNow={match.server_now} label="집합 마감까지" onTimeout={() => void refresh(false)} /></section>

        <section className={styles.section} aria-labelledby="members-title">
          <div className={styles.sectionHeader}><div><h2 id="members-title">팀원 도착 현황</h2><p>실명 대신 이번 매칭에서만 쓰는 임시 이름입니다.</p></div><strong>{arrivedPeople}/{match.total_party_size}명</strong></div>
          <ul className={styles.memberList}>{match.members.map((member) => { const status = memberStatus(member); return <li className={styles.memberRow} key={member.id}><span className={styles.memberIdentity}><strong>{member.nickname}{member.id === match.viewer_entry_id ? " · 나" : ""}</strong><span>{member.party_size}명 일행</span></span><span className={styles.statusPill} data-tone={status.tone}>{status.label}</span></li>; })}</ul>
          {excludedPeople > 0 ? <StatusMessage tone="warning" title={`${excludedPeople}명이 집합에서 제외됐어요.`}>도착 확인을 마친 서로 다른 일행이 2팀 이상이면 남은 인원으로 출발할 수 있습니다.</StatusMessage> : null}
        </section>

        <section className={styles.section} aria-labelledby="team-action">
          <div className={styles.sectionHeader}><div><h2 id="team-action">다음 행동</h2><p>{viewer?.status === "matched" ? "실제로 승차 지점에 도착한 뒤 확인해주세요." : match.status === "ready" ? "택시 탑승 직전에 대표 한 명이 출발을 확정해주세요." : "다른 팀원의 도착을 기다리고 있어요."}</p></div></div>
          {viewer?.status === "matched" ? <button className="button button--primary" type="button" disabled={busy !== null} onClick={() => void transition("arrive")}>{busy === "arrive" ? "도착 처리 중…" : "승차 지점 도착 확인"}</button> : null}
          {viewer?.status === "arrived" && match.status === "assembling" ? <StatusMessage tone="success" title="내 도착 확인을 마쳤어요.">전원이 도착하거나 집합 마감이 될 때까지 이 화면을 유지해주세요.</StatusMessage> : null}
          {viewer?.status === "arrived" && match.status === "ready" ? <button className="button button--primary" type="button" disabled={busy !== null} onClick={() => setDepartOpen(true)}>{excludedPeople > 0 ? "도착한 인원으로 출발" : "팀 출발 완료"}</button> : null}
        </section>

        <section className={styles.section} aria-labelledby="report-title">
          <div className={styles.sectionHeader}><div><h2 id="report-title">운영자에게 알리기</h2><p>노쇼, 인원 불일치, 불쾌한 행동을 운영자가 확인합니다.</p></div><button className="button button--secondary" type="button" aria-expanded={reportOpen} onClick={() => setReportOpen((open) => !open)}>{reportOpen ? "신고 닫기" : "문제 신고"}</button></div>
          {reportOpen ? <form className={styles.reportForm} onSubmit={submitReport}>
            <div className={styles.field}><label htmlFor="report-type">신고 유형</label><select id="report-type" value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}><option value="noshow">집합 장소에 나타나지 않음</option><option value="wrong_count">등록 인원과 실제 인원이 다름</option><option value="bad_behavior">불쾌하거나 위험한 행동</option><option value="other">기타</option></select></div>
            <div className={styles.field}><label htmlFor="report-description">상세 내용</label><textarea id="report-description" maxLength={500} value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} placeholder="운영자가 상황을 이해할 수 있도록 적어주세요." /></div>
            <button className="button button--danger" type="submit" disabled={busy !== null}>{busy === "report" ? "신고 접수 중…" : "신고 접수"}</button>
          </form> : null}
        </section>
      </div>

      <ConfirmDialog open={departOpen} title={excludedPeople > 0 ? "도착한 인원으로 출발할까요?" : "팀 출발을 완료할까요?"} description={excludedPeople > 0 ? `${excludedPeople}명은 노쇼로 제외됩니다. 현재 도착한 ${arrivedPeople}명으로 출발 상태를 확정합니다.` : "한 명이 확인하면 모든 팀원의 화면이 출발 완료로 바뀝니다."} confirmLabel="출발 완료" busy={busy === "depart"} onConfirm={() => void transition("depart")} onClose={() => setDepartOpen(false)} />
    </main>
  );
}
