"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { sendAdminRequest } from "./admin-api";
import type { AdminDashboardData, AdminDropZone, DestinationDraft, FareDraft } from "./types";
import styles from "../admin.module.css";

type DestinationManagerProps = {
  readonly data: AdminDashboardData;
  readonly onChanged: () => Promise<void>;
  readonly onUnauthorized: (message: string) => void;
  readonly notify: (message: string, tone: "success" | "error" | "info") => void;
};

type PendingAction = { readonly zone: AdminDropZone; readonly status: "active" | "inactive" } | null;

function makeFareDrafts(data: AdminDashboardData, zone?: AdminDropZone): readonly FareDraft[] {
  return data.pickup_spots.map((pickup) => {
    const fare = zone ? data.fares.find((item) => item.pickup_spot_id === pickup.id && item.drop_zone_id === zone.id) : undefined;
    return { pickupSpotId: pickup.id, fareMin: fare ? String(fare.fare_min) : "", fareMax: fare ? String(fare.fare_max) : "", rideMinutes: fare ? String(fare.ride_minutes) : "" };
  });
}

function makeDraft(data: AdminDashboardData, zone?: AdminDropZone): DestinationDraft {
  return zone
    ? { id: zone.id, name: zone.name, description: zone.description ?? "", zoneGroup: zone.zone_group, walkMinutes: String(zone.walk_minutes), status: zone.status, fares: makeFareDrafts(data, zone) }
    : { id: "", name: "", description: "", zoneGroup: "mid", walkMinutes: "5", status: "draft", fares: makeFareDrafts(data) };
}

function parseFares(fares: readonly FareDraft[]): { readonly kind: "ok"; readonly fares: readonly { readonly pickup_spot_id: string; readonly fare_min: number; readonly fare_max: number; readonly ride_minutes: number }[] } | { readonly kind: "error"; readonly message: string } {
  const parsed = [] as { pickup_spot_id: string; fare_min: number; fare_max: number; ride_minutes: number }[];
  for (const fare of fares) {
    const fields = [fare.fareMin, fare.fareMax, fare.rideMinutes];
    const empty = fields.every((field) => field.trim() === "");
    if (empty) continue;
    const fareMin = Number(fare.fareMin);
    const fareMax = Number(fare.fareMax);
    const rideMinutes = Number(fare.rideMinutes);
    if (!Number.isInteger(fareMin) || !Number.isInteger(fareMax) || !Number.isInteger(rideMinutes) || fareMin < 1 || fareMax < fareMin || rideMinutes < 1) {
      return { kind: "error", message: "요금은 최소·최대·시간을 모두 올바른 정수로 입력해주세요." };
    }
    parsed.push({ pickup_spot_id: fare.pickupSpotId, fare_min: fareMin, fare_max: fareMax, ride_minutes: rideMinutes });
  }
  return { kind: "ok", fares: parsed };
}

export default function DestinationManager({ data, onChanged, onUnauthorized, notify }: DestinationManagerProps) {
  const zones = useMemo(() => [...data.drop_zones].sort((left, right) => left.display_order - right.display_order || left.name.localeCompare(right.name)), [data.drop_zones]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const activePickupNames = useMemo(() => {
    const names: string[] = [];
    for (const pickup of data.pickup_spots) {
      if (pickup.active) names.push(pickup.name);
    }
    return names;
  }, [data.pickup_spots]);

  function startCreate(): void {
    setEditingId(null);
    setDraft(makeDraft(data));
    setValidation(null);
  }

  function startEdit(zone: AdminDropZone): void {
    setEditingId(zone.id);
    setDraft(makeDraft(data, zone));
    setValidation(null);
  }

  function updateFare(pickupSpotId: string, field: "fareMin" | "fareMax" | "rideMinutes", event: ChangeEvent<HTMLInputElement>): void {
    setDraft((current) => current ? { ...current, fares: current.fares.map((fare) => fare.pickupSpotId === pickupSpotId ? { ...fare, [field]: event.target.value } : fare) } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    const id = draft.id.trim().toLowerCase();
    const name = draft.name.trim();
    const walkMinutes = Number(draft.walkMinutes);
    const fares = parseFares(draft.fares);
    if (!id || !/^[a-z0-9][a-z0-9_-]{1,47}$/.test(id) || !name || !Number.isInteger(walkMinutes) || walkMinutes < 0 || walkMinutes > 60) {
      setValidation("ID는 영문 소문자·숫자·-_만, 이름과 도보 시간은 필수입니다.");
      return;
    }
    if (fares.kind === "error") {
      setValidation(fares.message);
      return;
    }
    if (draft.status === "active" && fares.fares.length < activePickupNames.length) {
      setValidation(`활성화하려면 모든 활성 승차 지점의 요금표가 필요합니다: ${activePickupNames.join(", ")}`);
      return;
    }

    setBusy(true);
    setValidation(null);
    try {
      const body = { id, name, description: draft.description.trim() || null, zone_group: draft.zoneGroup, walk_minutes: walkMinutes, status: draft.status, fares: fares.fares };
      const result = editingId ? await sendAdminRequest(`/api/admin/drop-zones/${encodeURIComponent(editingId)}`, "PATCH", body) : await sendAdminRequest("/api/admin/drop-zones", "POST", { ...body, display_order: (zones.at(-1)?.display_order ?? 0) + 10 });
      if (result.kind === "unauthorized") {
        onUnauthorized(result.message);
        return;
      }
      if (result.kind === "error") {
        setValidation(result.message);
        notify(result.message, "error");
        return;
      }
      notify(editingId ? "하차 지점과 요금표를 저장했습니다." : "하차 지점을 만들었습니다.", "success");
      setDraft(null);
      await onChanged();
    } catch {
      notify("저장 결과를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 확인해주세요.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function reorder(zone: AdminDropZone, direction: -1 | 1): Promise<void> {
    const index = zones.findIndex((item) => item.id === zone.id);
    const target = zones[index + direction];
    if (!target) return;
    setBusy(true);
    try {
      const swapped = zones.map((item, currentIndex) => currentIndex === index ? target : currentIndex === index + direction ? zone : item);
      const result = await sendAdminRequest("/api/admin/drop-zones/reorder", "PATCH", { items: swapped.map((item, order) => ({ id: item.id, display_order: (order + 1) * 10 })) });
      if (result.kind === "unauthorized") {
        onUnauthorized(result.message);
        return;
      }
      if (result.kind === "error") {
        notify(result.message, "error");
        return;
      }
      notify("표시 순서를 저장했습니다.", "success");
      await onChanged();
    } catch {
      notify("순서 변경 결과를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 확인해주세요.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(): Promise<void> {
    if (!pendingAction) return;
    setBusy(true);
    try {
      const result = await sendAdminRequest(`/api/admin/drop-zones/${encodeURIComponent(pendingAction.zone.id)}`, "PATCH", { status: pendingAction.status });
      if (result.kind === "unauthorized") {
        onUnauthorized(result.message);
        return;
      }
      if (result.kind === "error") {
        setValidation(result.message);
        setEditingId(pendingAction.zone.id);
        setDraft(makeDraft(data, pendingAction.zone));
        setPendingAction(null);
        notify(result.message, "error");
        return;
      }
      notify(pendingAction.status === "active" ? "하차 지점을 활성화했습니다." : "하차 지점을 비활성화했습니다. 기존 매칭은 유지됩니다.", "success");
      setPendingAction(null);
      await onChanged();
    } catch {
      notify("상태 변경 결과를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 확인해주세요.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.destinationManager} aria-labelledby="destination-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>CATALOG</p><h2 id="destination-title">하차 지점</h2><p>삭제하지 않고 비활성화합니다. 비활성 지점은 신규 대기열에만 노출되지 않습니다.</p></div>
        <button className="button button--primary" type="button" onClick={startCreate}>하차 지점 추가</button>
      </div>
      {validation ? <StatusMessage tone="error" title="저장할 수 없습니다." live="assertive">{validation}</StatusMessage> : null}
      <div className={styles.destinationGrid}>
        <div className={styles.destinationList} aria-label="하차 지점 목록">
          {zones.map((zone, index) => (
            <article className={styles.destinationItem} key={zone.id}>
              <div className={styles.destinationMeta}><div><h3>{zone.name}</h3><p>{zone.description || "설명 없음"} · 도보 {zone.walk_minutes}분 · {zone.zone_group === "mid" ? "중간 권역" : "상단 권역"}</p></div><span className={zone.status === "active" ? styles.activeBadge : zone.status === "draft" ? styles.draftBadge : styles.inactiveBadge}>{zone.status === "active" ? "활성" : zone.status === "draft" ? "초안" : "비활성"}</span></div>
              <div className={styles.rowActions}>
                <button className="button button--secondary" disabled={busy || index === 0} type="button" onClick={() => void reorder(zone, -1)} aria-label={`${zone.name} 위로 이동`}>위로</button>
                <button className="button button--secondary" disabled={busy || index === zones.length - 1} type="button" onClick={() => void reorder(zone, 1)} aria-label={`${zone.name} 아래로 이동`}>아래로</button>
                <button className="button button--secondary" disabled={busy} type="button" onClick={() => startEdit(zone)}>편집</button>
                <button className={zone.status === "active" ? "button button--secondary" : "button button--primary"} disabled={busy} type="button" onClick={() => setPendingAction({ zone, status: zone.status === "active" ? "inactive" : "active" })}>{zone.status === "active" ? "비활성화" : "활성화"}</button>
              </div>
            </article>
          ))}
          {zones.length === 0 ? <StatusMessage tone="info" title="등록된 하차 지점이 없습니다.">첫 지점을 추가하면 승객 화면에 노출할 준비를 할 수 있습니다.</StatusMessage> : null}
        </div>
        {draft ? <form className={styles.destinationForm} onSubmit={(event) => void save(event)}>
          <div className={styles.sectionHeading}><div><h2>{editingId ? "하차 지점 편집" : "하차 지점 추가"}</h2><p>활성화 전에는 모든 활성 승차 지점의 요금표를 입력해야 합니다.</p></div><button className="button button--secondary" type="button" onClick={() => setDraft(null)}>닫기</button></div>
          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}><label htmlFor="zone-id">ID</label><input id="zone-id" disabled={editingId !== null} maxLength={48} required value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></div>
            <div className={styles.fieldGroup}><label htmlFor="zone-name">표시 이름</label><input id="zone-name" maxLength={60} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className={styles.fieldGroup}><label htmlFor="zone-group">권역</label><select id="zone-group" value={draft.zoneGroup} onChange={(event) => setDraft({ ...draft, zoneGroup: event.target.value === "upper" ? "upper" : "mid" })}><option value="mid">중간 권역</option><option value="upper">상단 권역</option></select></div>
            <div className={styles.fieldGroup}><label htmlFor="walk-minutes">하차 후 도보(분)</label><input id="walk-minutes" min="0" max="60" required type="number" value={draft.walkMinutes} onChange={(event) => setDraft({ ...draft, walkMinutes: event.target.value })} /></div>
          </div>
          <div className={styles.fieldGroup}><label htmlFor="zone-description">보조 설명</label><textarea id="zone-description" maxLength={140} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
          <div className={styles.fieldGroup}><label htmlFor="zone-status">노출 상태</label><select id="zone-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value === "active" ? "active" : event.target.value === "inactive" ? "inactive" : "draft" })}><option value="draft">초안 · 관리자만 확인</option><option value="active">활성 · 승객 화면 노출</option><option value="inactive">비활성 · 신규 대기에서 숨김</option></select></div>
          <fieldset className={styles.fareFieldset}><legend>승차 지점별 요금표</legend>{data.pickup_spots.map((pickup) => { const fare = draft.fares.find((item) => item.pickupSpotId === pickup.id); return fare ? <div className={styles.fareRow} key={pickup.id}><p><strong>{pickup.name}</strong><span>{pickup.active ? "활성 승차 지점" : "비활성 승차 지점"}</span></p><label>최소 요금<input inputMode="numeric" min="1" type="number" value={fare.fareMin} onChange={(event) => updateFare(pickup.id, "fareMin", event)} /></label><label>최대 요금<input inputMode="numeric" min="1" type="number" value={fare.fareMax} onChange={(event) => updateFare(pickup.id, "fareMax", event)} /></label><label>예상 시간<input inputMode="numeric" min="1" type="number" value={fare.rideMinutes} onChange={(event) => updateFare(pickup.id, "rideMinutes", event)} /></label></div> : null; })}</fieldset>
          <div className={styles.rowActions}><button className="button button--primary" disabled={busy} type="submit">{busy ? "저장 중…" : "저장"}</button><button className="button button--secondary" disabled={busy} type="button" onClick={() => setDraft(null)}>취소</button></div>
        </form> : null}
      </div>
      <ConfirmDialog open={pendingAction !== null} title={pendingAction?.status === "active" ? "하차 지점을 활성화할까요?" : "하차 지점을 비활성화할까요?"} description={pendingAction?.status === "active" ? "모든 활성 승차 지점의 요금표가 있어야 승객 화면에 노출됩니다." : "새 대기열에는 더 이상 노출되지 않으며, 이미 생성된 매칭은 그대로 유지됩니다."} confirmLabel={pendingAction?.status === "active" ? "활성화" : "비활성화"} tone={pendingAction?.status === "active" ? "default" : "danger"} busy={busy} onConfirm={() => void setStatus()} onClose={() => setPendingAction(null)} />
    </section>
  );
}
