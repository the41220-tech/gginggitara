"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import RoomCard, { type JoinRouteCard } from "@/components/RoomCard";
import StepSelector from "@/components/StepSelector";
import { useToast } from "@/components/Toast";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { participantFetch } from "@/lib/client-session";
import { trackProductEvent } from "@/lib/analytics";
import styles from "@/app/public-flow.module.css";

type PickupSpot = { readonly id: string; readonly name: string; readonly location_desc: string; readonly color: string };
type RoomFare = { readonly fare_min: number; readonly fare_max: number; readonly ride_minutes: number };
type Room = {
  readonly drop_zone_id: string;
  readonly zone_name: string;
  readonly description: string | null;
  readonly walk_minutes: number;
  readonly display_order: number;
  readonly fare: RoomFare;
  readonly total_people: number | null;
  readonly slots_left: number | null;
};
type SavedSelections = { readonly partySize?: number; readonly pickupSpot?: string; readonly dropZone?: string; readonly departureMode?: "fast" | "cheap" };
type LoadState = "loading" | "ready" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") return value.error;
  return isRecord(value.error) && typeof value.error.message === "string" ? value.error.message : fallback;
}

function parsePickups(value: unknown): readonly PickupSpot[] | null {
  if (!isRecord(value) || !Array.isArray(value.pickup_spots)) return null;
  const pickups: PickupSpot[] = [];
  for (const item of value.pickup_spots) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.location_desc !== "string" || typeof item.color !== "string") return null;
    pickups.push({ id: item.id, name: item.name, location_desc: item.location_desc, color: item.color });
  }
  return pickups;
}

function parseRooms(value: unknown): readonly Room[] | null {
  if (!isRecord(value) || !Array.isArray(value.rooms)) return null;
  const rooms: Room[] = [];
  for (const item of value.rooms) {
    if (!isRecord(item) || typeof item.drop_zone_id !== "string" || typeof item.zone_name !== "string" || (item.description !== null && typeof item.description !== "string") || typeof item.walk_minutes !== "number" || typeof item.display_order !== "number" || !isRecord(item.fare) || typeof item.fare.fare_min !== "number" || typeof item.fare.fare_max !== "number" || typeof item.fare.ride_minutes !== "number" || (item.total_people !== null && typeof item.total_people !== "number") || (item.slots_left !== null && typeof item.slots_left !== "number")) return null;
    rooms.push({
      drop_zone_id: item.drop_zone_id,
      zone_name: item.zone_name,
      description: item.description,
      walk_minutes: item.walk_minutes,
      display_order: item.display_order,
      fare: { fare_min: item.fare.fare_min, fare_max: item.fare.fare_max, ride_minutes: item.fare.ride_minutes },
      total_people: item.total_people,
      slots_left: item.slots_left,
    });
  }
  return rooms.sort((left, right) => left.display_order - right.display_order || left.zone_name.localeCompare(right.zone_name, "ko"));
}

function readSavedSelections(): SavedSelections {
  try {
    const raw = sessionStorage.getItem("kkinggitaja_selections");
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    return {
      partySize: typeof value.partySize === "number" && [1, 2, 3].includes(value.partySize) ? value.partySize : undefined,
      pickupSpot: typeof value.pickupSpot === "string" ? value.pickupSpot : undefined,
      dropZone: typeof value.dropZone === "string" ? value.dropZone : undefined,
      departureMode: value.departureMode === "fast" || value.departureMode === "cheap" ? value.departureMode : undefined,
    };
  } catch {
    return {};
  }
}

function toRouteCard(room: Room): JoinRouteCard {
  return { id: room.drop_zone_id, name: room.zone_name, description: room.description, walkMinutes: room.walk_minutes, fareMin: room.fare.fare_min, fareMax: room.fare.fare_max, totalPeople: room.total_people, slotsLeft: room.slots_left };
}

function perPersonFare(fare: number, people: number): string {
  return `${(Math.ceil(fare / people / 100) * 100).toLocaleString("ko-KR")}원`;
}

export default function JoinPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pickups, setPickups] = useState<readonly PickupSpot[]>([]);
  const [rooms, setRooms] = useState<readonly Room[]>([]);
  const [pickupSpot, setPickupSpot] = useState("");
  const [dropZone, setDropZone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [departureMode, setDepartureMode] = useState<"fast" | "cheap">("fast");
  const [joining, setJoining] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<Date | null>(null);

  const loadRooms = useCallback(async (pickupId: string, preferredDropZone?: string): Promise<readonly Room[]> => {
    const response = await fetch(`/api/queue/rooms?pickup_spot_id=${encodeURIComponent(pickupId)}`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(apiMessage(payload, "하차 지점을 불러오지 못했어요."));
    const nextRooms = parseRooms(payload);
    if (!nextRooms) throw new Error("하차 지점 응답 형식을 확인하지 못했어요.");
    setRooms(nextRooms);
    setLiveUpdatedAt(new Date());
    setDropZone((current) => {
      const preferred = preferredDropZone && nextRooms.some((room) => room.drop_zone_id === preferredDropZone) ? preferredDropZone : current;
      return nextRooms.some((room) => room.drop_zone_id === preferred) ? preferred : "";
    });
    return nextRooms;
  }, []);

  const loadExperience = useCallback(async (): Promise<void> => {
    setLoadState("loading");
    try {
      const saved = readSavedSelections();
      const response = await fetch("/api/catalog", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(payload, "승차 지점을 불러오지 못했어요."));
      const nextPickups = parsePickups(payload);
      if (!nextPickups || nextPickups.length === 0) throw new Error("현재 이용 가능한 승차 지점이 없어요.");
      const nextPickupId = saved.pickupSpot && nextPickups.some((pickup) => pickup.id === saved.pickupSpot) ? saved.pickupSpot : nextPickups[0]?.id ?? "";
      setPickups(nextPickups);
      setPickupSpot(nextPickupId);
      if (saved.partySize) setPartySize(saved.partySize);
      if (saved.departureMode) setDepartureMode(saved.departureMode);
      await loadRooms(nextPickupId, saved.dropZone);
      setLoadState("ready");
      trackProductEvent({ eventName: "join_started" });
    } catch (error) {
      setLoadState("error");
      showToast(error instanceof Error ? error.message : "목록을 불러오지 못했어요.", "error");
    }
  }, [loadRooms, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadExperience(), 0);
    return () => window.clearTimeout(timer);
  }, [loadExperience]);

  useEffect(() => {
    if (loadState !== "ready" || !pickupSpot) return;
    const interval = window.setInterval(() => void loadRooms(pickupSpot).catch(() => undefined), 15_000);
    return () => window.clearInterval(interval);
  }, [loadRooms, loadState, pickupSpot]);

  const selectedPickup = pickups.find((pickup) => pickup.id === pickupSpot) ?? null;
  const selectedRoom = rooms.find((room) => room.drop_zone_id === dropZone) ?? null;

  async function changePickup(nextPickupId: string): Promise<void> {
    setPickupSpot(nextPickupId);
    setDropZone("");
    setRooms([]);
    try {
      await loadRooms(nextPickupId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "하차 지점을 불러오지 못했어요.", "error");
    }
  }

  function selectDropZone(nextDropZone: string): void {
    setDropZone(nextDropZone);
    trackProductEvent({ eventName: "drop_zone_selected", properties: { drop_zone_id: nextDropZone } });
  }

  async function joinQueue(): Promise<void> {
    if (!selectedRoom || !selectedPickup || joining) return;
    setJoining(true);
    sessionStorage.setItem("kkinggitaja_selections", JSON.stringify({ partySize, pickupSpot, dropZone, departureMode }));
    trackProductEvent({ eventName: "matching_started", properties: { drop_zone_id: dropZone, party_size: partySize as 1 | 2 | 3, preference: departureMode } });
    try {
      const response = await participantFetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ party_size: partySize, pickup_spot_id: pickupSpot, drop_zone_id: dropZone, departure_mode: departureMode }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") throw new Error(apiMessage(payload, "대기를 시작하지 못했어요. 선택 내용은 유지했어요."));
      router.push(`/waiting/${payload.id}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "네트워크 연결을 확인해주세요.", "error");
      setJoining(false);
    }
  }

  return (
    <main className={`public-shell ${styles.page}`}>
      <div className={styles.topbar}>
        <Link className={styles.brand} href="/join" aria-label="낑기타자 처음으로"><span className={styles.brandMark} aria-hidden="true" /><span>낑기타자</span></Link>
        <span className={styles.serviceChip}>부산대역 출발</span>
      </div>
      <div className={styles.main}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>부산대 택시 동승</span>
          <h1>같은 방향이면, 같이 올라가요.</h1>
          <p>하차 지점을 고르면 최대 4명까지 자동으로 팀을 찾아드려요. 로그인 없이 약 1분이면 충분합니다.</p>
        </header>

        {loadState === "loading" ? <div className={styles.loadingPanel}><LoadingSpinner message="이용 가능한 경로를 확인하고 있어요." /></div> : null}
        {loadState === "error" ? (
          <section className={`surface-card ${styles.emptyState}`}>
            <StatusMessage tone="error" title="경로를 불러오지 못했어요.">선택 내용은 기기에 남아 있어요. 연결을 확인한 뒤 다시 시도해주세요.</StatusMessage>
            <button className="button button--primary" type="button" onClick={() => void loadExperience()}>경로 다시 불러오기</button>
          </section>
        ) : null}

        {loadState === "ready" ? (
          <div className={styles.joinGrid}>
            <div className={styles.formColumn}>
              <section className={styles.section} aria-labelledby="pickup-title">
                <div className={styles.sectionHeader}><div><h2 id="pickup-title">어디서 탈까요?</h2><p>지금 서 있는 출구 쪽 승차 지점을 골라주세요.</p></div><span className={styles.pill}>1</span></div>
                <fieldset><legend className="sr-only">승차 지점</legend><div className={styles.optionGrid}>{pickups.map((pickup) => (
                  <label className={styles.optionLabel} key={pickup.id}><input type="radio" name="pickup" value={pickup.id} checked={pickupSpot === pickup.id} onChange={() => void changePickup(pickup.id)} /><span className={styles.optionCopy}><strong>{pickup.name}</strong><span>{pickup.location_desc}</span></span></label>
                ))}</div></fieldset>
              </section>

              <section className={styles.section} aria-labelledby="party-title">
                <div className={styles.sectionHeader}><div><h2 id="party-title">일행은 몇 명인가요?</h2><p>나를 포함한 실제 탑승 인원이에요.</p></div><span className={styles.pill}>2</span></div>
                <StepSelector name="party-size" legend="일행 인원" options={[{ value: 1, label: "1명", description: "혼자" }, { value: 2, label: "2명", description: "둘이" }, { value: 3, label: "3명", description: "셋이" }]} value={partySize} onChange={(value) => setPartySize(Number(value))} />
              </section>

              <section className={styles.section} aria-labelledby="destination-title">
                <div className={styles.sectionHeader}><div><h2 id="destination-title">어디에서 내릴까요?</h2><p>도보 시간을 포함해 가장 가까운 하차 지점을 골라주세요.</p></div><span className={styles.pill}>3</span></div>
                {rooms.length > 0 ? <div className={styles.routeList}>{rooms.map((room) => <RoomCard key={room.drop_zone_id} route={toRouteCard(room)} selected={dropZone === room.drop_zone_id} onSelect={selectDropZone} />)}</div> : <StatusMessage tone="info" title="이 승차 지점에서 이용 가능한 경로가 없어요.">다른 승차 지점을 선택해주세요.</StatusMessage>}
                <p className={styles.meta} aria-live="polite">{liveUpdatedAt ? `대기 인원 ${liveUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준` : "대기 인원을 확인 중이에요."}</p>
              </section>

              <section className={styles.section} aria-labelledby="preference-title">
                <div className={styles.sectionHeader}><div><h2 id="preference-title">무엇을 우선할까요?</h2><p>4명이 모이면 선택과 관계없이 바로 제안해요.</p></div></div>
                <fieldset><legend className="sr-only">매칭 우선순위</legend><div className={styles.optionGrid}>
                  <label className={styles.optionLabel}><input type="radio" name="departure-mode" value="fast" checked={departureMode === "fast"} onChange={() => setDepartureMode("fast")} /><span className={styles.optionCopy}><strong>빠른 출발</strong><span>서로 다른 일행 2팀, 총 2~3명부터 바로 제안</span></span></label>
                  <label className={styles.optionLabel}><input type="radio" name="departure-mode" value="cheap" checked={departureMode === "cheap"} onChange={() => setDepartureMode("cheap")} /><span className={styles.optionCopy}><strong>요금 절약</strong><span>최대 3분 동안 4명을 우선 모집</span></span></label>
                </div></fieldset>
              </section>
            </div>

            <aside className={styles.summaryColumn} aria-label="선택 요약">
              <div className={styles.summaryCard}>
                <div><p className={styles.meta}>선택한 경로</p><h2>{selectedRoom ? selectedRoom.zone_name : "하차 지점을 골라주세요"}</h2></div>
                <div>
                  <div className={styles.summaryRow}><span>승차</span><strong>{selectedPickup?.name ?? "-"}</strong></div>
                  <div className={styles.summaryRow}><span>탑승</span><strong>{partySize}명</strong></div>
                  <div className={styles.summaryRow}><span>우선순위</span><strong>{departureMode === "fast" ? "빠른 출발" : "요금 절약"}</strong></div>
                  <div className={styles.summaryRow}><span>예상 이동</span><strong>{selectedRoom ? `택시 ${selectedRoom.fare.ride_minutes}분 + 도보 ${selectedRoom.walk_minutes}분` : "-"}</strong></div>
                </div>
                {selectedRoom ? <p className={styles.helper}>4명 탑승 시 1인 약 {perPersonFare(selectedRoom.fare.fare_min, 4)}~{perPersonFare(selectedRoom.fare.fare_max, 4)}</p> : <p className={styles.helper}>요금은 교통 상황에 따라 달라질 수 있어요.</p>}
                <button className={`button button--primary ${styles.primaryWide}`} type="button" disabled={!selectedRoom || joining} onClick={() => void joinQueue()}>{joining ? "대기열에 등록 중…" : selectedRoom ? `${selectedRoom.zone_name} 매칭 시작` : "하차 지점을 선택해주세요"}</button>
              </div>
              <p className={styles.helper}>대기 등록 후 20초 매칭 제안을 모두 수락해야 팀이 확정돼요. 연락처와 실명은 수집하지 않습니다.</p>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}
