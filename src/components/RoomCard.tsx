"use client";

import styles from "@/app/public-flow.module.css";

export type JoinRouteCard = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly walkMinutes: number;
  readonly fareMin: number;
  readonly fareMax: number;
  readonly totalPeople: number | null;
  readonly slotsLeft: number | null;
};

type RoomCardProps = {
  readonly route: JoinRouteCard;
  readonly selected: boolean;
  readonly onSelect: (routeId: string) => void;
};

function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function perPersonRange(fareMin: number, fareMax: number, passengers: number): string {
  const roundToHundred = (amount: number) => Math.ceil(amount / 100) * 100;
  return `${formatWon(roundToHundred(fareMin / passengers))}~${formatWon(roundToHundred(fareMax / passengers))}`;
}

export default function RoomCard({ route, selected, onSelect }: RoomCardProps) {
  const availability = route.totalPeople === null
    ? "실시간 대기 인원 확인 중"
    : route.totalPeople > 0
      ? `현재 ${route.totalPeople}명 대기 · ${route.slotsLeft ?? 0}자리 남음`
      : "현재 대기자 없음";

  return (
    <button
      type="button"
      onClick={() => onSelect(route.id)}
      aria-pressed={selected}
      className={styles.routeCard}
    >
      <span className={styles.routeTop}>
        <span>
          <strong className={styles.routeName}>{route.name}</strong>
          <span className={styles.routeDescription}>{route.description ?? `하차 후 도보 약 ${route.walkMinutes}분`}</span>
        </span>
        <span className={styles.walkBadge}>도보 {route.walkMinutes}분</span>
      </span>
      <span className={styles.routeMeta}>{availability}</span>
      <span className={styles.fareGrid}>
        <span className={styles.fareCell}><span>2명 탑승 시</span><strong>{perPersonRange(route.fareMin, route.fareMax, 2)} / 1인</strong></span>
        <span className={styles.fareCell}><span>4명 탑승 시</span><strong>{perPersonRange(route.fareMin, route.fareMax, 4)} / 1인</strong></span>
      </span>
    </button>
  );
}
