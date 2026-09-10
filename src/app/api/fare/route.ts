import { loadActiveCatalog } from "@/lib/catalog";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function roundUpToHundred(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spotId = (searchParams.get("spot") ?? searchParams.get("pickup_spot_id"))?.trim() ?? null;
  const zoneId = (searchParams.get("zone") ?? searchParams.get("drop_zone_id"))?.trim() ?? null;
  const rawPartySize = searchParams.get("party_size") ?? "1";
  const partySize = Number(rawPartySize);

  if (!spotId || !zoneId || !Number.isInteger(partySize) || partySize < 1 || partySize > 3) {
    return jsonNoStore(
      { error: { code: "INVALID_FARE_REQUEST", message: "요금 조회 조건을 확인해주세요." } },
      400,
    );
  }

  const catalog = await loadActiveCatalog(spotId);
  if (catalog.kind === "database_error") {
    return jsonNoStore(
      { error: { code: "CATALOG_UNAVAILABLE", message: "경로 목록을 불러오지 못했습니다." } },
      503,
    );
  }
  if (catalog.kind !== "ok") {
    return jsonNoStore(
      { error: { code: "ROUTE_UNAVAILABLE", message: "사용할 수 없는 경로입니다." } },
      404,
    );
  }

  const route = catalog.routes.find((candidate) => candidate.id === zoneId);
  if (!route) {
    return jsonNoStore(
      { error: { code: "FARE_UNAVAILABLE", message: "등록된 요금 정보가 없습니다." } },
      404,
    );
  }

  const assumedTotalPeople = Math.max(partySize, 2);
  const fareMin = roundUpToHundred(route.fare.fare_min);
  const fareMax = roundUpToHundred(route.fare.fare_max);

  return jsonNoStore({
    fare_min: fareMin,
    fare_max: fareMax,
    per_person_min: roundUpToHundred(fareMin / assumedTotalPeople),
    per_person_max: roundUpToHundred(fareMax / assumedTotalPeople),
    ride_minutes: route.fare.ride_minutes,
    eta: route.fare.ride_minutes + 5,
    assumed_total_people: assumedTotalPeople,
  });
}
