"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/Toast";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { participantFetch } from "@/lib/client-session";
import { trackProductEvent } from "@/lib/analytics";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import styles from "@/app/public-flow.module.css";

type FareSummary = {
  readonly totalMin: number;
  readonly totalMax: number;
  readonly totalPeople: number;
  readonly perPersonMin: number;
  readonly perPersonMax: number;
  readonly viewerPartySize: number;
  readonly actualTotal?: number | null;
  readonly viewerPartyAmount?: number | null;
};

type SettlementData = {
  readonly hasAccount: boolean;
  readonly payerNickname?: string;
  readonly bankName?: string;
  readonly accountNumber?: string;
  readonly accountHolderMasked?: string;
  readonly isViewerPayer?: boolean;
  readonly canEdit?: boolean;
  readonly fare: FareSummary;
};

const BANKS = ["카카오뱅크", "토스뱅크", "국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "SC제일은행", "부산은행", "대구은행", "경남은행", "광주은행", "전북은행", "제주은행", "새마을금고", "신협", "우체국", "수협", "케이뱅크"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") return value.error;
  return isRecord(value.error) && typeof value.error.message === "string" ? value.error.message : fallback;
}

function parseFare(value: unknown): FareSummary | null {
  if (!isRecord(value) || typeof value.totalMin !== "number" || typeof value.totalMax !== "number" || typeof value.totalPeople !== "number" || typeof value.perPersonMin !== "number" || typeof value.perPersonMax !== "number" || typeof value.viewerPartySize !== "number") return null;
  return {
    totalMin: value.totalMin,
    totalMax: value.totalMax,
    totalPeople: value.totalPeople,
    perPersonMin: value.perPersonMin,
    perPersonMax: value.perPersonMax,
    viewerPartySize: value.viewerPartySize,
    actualTotal: value.actualTotal === null || typeof value.actualTotal === "number" ? value.actualTotal : undefined,
    viewerPartyAmount: value.viewerPartyAmount === null || typeof value.viewerPartyAmount === "number" ? value.viewerPartyAmount : undefined,
  };
}

function parseSettlement(value: unknown): SettlementData | null {
  if (!isRecord(value) || typeof value.hasAccount !== "boolean") return null;
  const fare = parseFare(value.fare);
  if (!fare) return null;
  if (!value.hasAccount) return { hasAccount: false, fare };
  if (typeof value.payerNickname !== "string" || typeof value.bankName !== "string" || typeof value.accountNumber !== "string" || typeof value.accountHolderMasked !== "string" || typeof value.isViewerPayer !== "boolean" || typeof value.canEdit !== "boolean") return null;
  return { hasAccount: true, payerNickname: value.payerNickname, bankName: value.bankName, accountNumber: value.accountNumber, accountHolderMasked: value.accountHolderMasked, isViewerPayer: value.isViewerPayer, canEdit: value.canEdit, fare };
}

function won(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export default function SettlementSection({ matchId }: { readonly matchId: string }) {
  const { showToast } = useToast();
  const [settlement, setSettlement] = useState<SettlementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [actualFare, setActualFare] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const loadSequenceRef = useRef(0);

  const loadSettlement = useCallback(async (announceError = false): Promise<void> => {
    const sequence = ++loadSequenceRef.current;
    try {
      const response = await participantFetch(`/api/settlement/${encodeURIComponent(matchId)}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (sequence !== loadSequenceRef.current) return;
      if (!response.ok) throw new Error(apiMessage(payload, "정산 정보를 불러오지 못했어요."));
      const nextSettlement = parseSettlement(payload);
      if (!nextSettlement) throw new Error("정산 정보 응답 형식을 확인하지 못했어요.");
      setSettlement(nextSettlement);
      setError(null);
    } catch (caught) {
      if (sequence !== loadSequenceRef.current) return;
      const message = caught instanceof Error ? caught.message : "정산 정보를 불러오지 못했어요.";
      setError(message);
      if (announceError) showToast(message, "error");
    }
  }, [matchId, showToast]);

  const pollSettlement = useCallback(() => void loadSettlement(false), [loadSettlement]);
  useVisiblePolling(pollSettlement, 5_000);

  useEffect(() => () => {
    loadSequenceRef.current += 1;
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const numericFare = Number(actualFare);
    if (!bankName || !/^[0-9-]{7,36}$/.test(accountNumber) || accountNumber.replaceAll("-", "").length < 7 || !accountHolder.trim() || !Number.isInteger(numericFare) || numericFare < 1000 || numericFare > 200000) {
      showToast("실제 요금과 계좌 정보를 모두 확인해주세요.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const response = await participantFetch(`/api/settlement/${encodeURIComponent(matchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankName, accountNumber, accountHolder: accountHolder.trim(), actualFare: numericFare, ...(editing ? { replace: true } : {}) }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload, "정산 정보를 전달하지 못했어요."));
      const nextSettlement = parseSettlement(payload);
      if (!nextSettlement) throw new Error("정산 정보 응답 형식을 확인하지 못했어요.");
      setSettlement(nextSettlement);
      setShowForm(false);
      setEditing(false);
      showToast(editing ? "정산 정보를 수정했어요." : "팀원에게 정산 정보를 전달했어요.", "success");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "정산 정보를 전달하지 못했어요.", "error");
      await loadSettlement(false);
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(): void {
    if (!settlement?.hasAccount || !settlement.canEdit) return;
    setBankName(settlement.bankName ?? "");
    setAccountNumber(settlement.accountNumber ?? "");
    setActualFare(settlement.fare.actualTotal?.toString() ?? "");
    setAccountHolder("");
    setEditing(true);
    setShowForm(true);
  }

  function cancelForm(): void {
    setShowForm(false);
    setEditing(false);
  }

  async function copyAccount(): Promise<void> {
    if (!settlement?.accountNumber) return;
    try {
      await navigator.clipboard.writeText(settlement.accountNumber);
      trackProductEvent({ eventName: "account_copied" });
      showToast("계좌번호를 복사했어요.", "success");
    } catch {
      showToast("자동 복사가 되지 않았어요. 계좌번호를 길게 눌러 복사해주세요.", "error");
    }
  }

  return (
    <section className={styles.section} aria-labelledby="settlement-title">
      <div className={styles.sectionHeader}><div><h2 id="settlement-title">택시비 정산</h2><p>계좌번호는 이 팀의 출발한 멤버에게만 표시됩니다.</p></div></div>
      {error && !settlement ? <StatusMessage tone="error" title="정산 정보를 확인하지 못했어요.">{error}</StatusMessage> : null}
      {error && !settlement ? <button className="button button--secondary" type="button" onClick={() => void loadSettlement(true)}>정산 정보 다시 확인</button> : null}
      {!settlement && !error ? <p className={styles.meta} role="status">정산 정보를 확인하고 있어요.</p> : null}

      {settlement?.hasAccount && !showForm ? (
        <div className={styles.accountBox}>
          {settlement.isViewerPayer ? <div><p className={styles.meta}>내가 먼저 결제한 실제 총요금</p><p className={styles.accountNumber}>{settlement.fare.actualTotal !== null && settlement.fare.actualTotal !== undefined ? won(settlement.fare.actualTotal) : "금액 확인 중"}</p><p className={styles.meta}>다른 일행에는 인원수에 맞춘 정확한 분담 금액과 계좌가 표시됩니다.</p></div> : <div><p className={styles.meta}>내 일행이 보낼 금액</p><p className={styles.accountNumber}>{settlement.fare.viewerPartyAmount !== null && settlement.fare.viewerPartyAmount !== undefined ? won(settlement.fare.viewerPartyAmount) : "금액 확인 중"}</p><p className={styles.meta}>일행별 분담 금액의 합은 실제 총요금 {settlement.fare.actualTotal !== null && settlement.fare.actualTotal !== undefined ? won(settlement.fare.actualTotal) : "-"}과 정확히 일치합니다.</p></div>}
          <div className={styles.summaryRow}><span>결제자</span><strong>{settlement.payerNickname}</strong></div>
          <div className={styles.summaryRow}><span>은행</span><strong>{settlement.bankName}</strong></div>
          <div><p className={styles.meta}>계좌번호 · 예금주 {settlement.accountHolderMasked}</p><p className={styles.accountNumber}>{settlement.accountNumber}</p></div>
          {settlement.isViewerPayer ? <p className={styles.meta}>내 계좌이므로 송금할 필요가 없어요.</p> : <button className="button button--primary" type="button" onClick={() => void copyAccount()}>계좌번호 복사</button>}
          {settlement.canEdit ? <button className="button button--secondary" type="button" onClick={startEdit}>정산 정보 수정</button> : null}
        </div>
      ) : settlement && !showForm ? (
        <div className={styles.stack}>
          <StatusMessage tone="info" title="아직 결제 계좌가 등록되지 않았어요.">택시비를 먼저 결제한 팀원 한 명이 실제 총요금과 계좌를 전달해주세요.</StatusMessage>
          <p className={styles.meta}>예상 총요금 {won(settlement.fare.totalMin)}~{won(settlement.fare.totalMax)} · 총 {settlement.fare.totalPeople}명</p>
          <button className="button button--secondary" type="button" onClick={() => setShowForm(true)}>제가 택시비를 결제했어요</button>
        </div>
      ) : settlement && showForm ? (
        <form className={styles.settlementForm} onSubmit={submit}>
          {editing ? <StatusMessage tone="info" title="정산 정보를 수정합니다.">예금주 이름은 저장된 값이 가려져 있어 다시 입력해 주세요.</StatusMessage> : null}
          <div className={styles.field}><label htmlFor="actual-fare">실제 총 택시비</label><input id="actual-fare" type="number" inputMode="numeric" min="1000" max="200000" step="100" required value={actualFare} onChange={(event) => setActualFare(event.target.value)} placeholder="예: 5600" /></div>
          <div className={styles.field}><label htmlFor="bank-name">은행</label><select id="bank-name" required value={bankName} onChange={(event) => setBankName(event.target.value)}><option value="">은행 선택</option>{BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="account-number">계좌번호</label><input id="account-number" type="text" inputMode="numeric" autoComplete="off" minLength={7} maxLength={36} required value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/[^0-9-]/g, ""))} placeholder="숫자와 하이픈만 입력" /></div>
          <div className={styles.field}><label htmlFor="account-holder">예금주</label><input id="account-holder" type="text" autoComplete="off" maxLength={30} required value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} /><span className={styles.meta}>예금주는 일부 가려서 표시해요.</span></div>
          <div className={styles.actions}><button className="button button--secondary" type="button" disabled={submitting} onClick={cancelForm}>취소</button><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? "전달 중…" : editing ? "정산 정보 수정" : "팀원에게 정산 정보 전달"}</button></div>
        </form>
      ) : null}
    </section>
  );
}
