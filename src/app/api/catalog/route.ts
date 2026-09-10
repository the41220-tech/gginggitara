import { loadActiveCatalog } from "@/lib/catalog";
import { jsonNoStore } from "@/lib/http";
import { attachParticipantSession, getOrCreateParticipantSession } from "@/lib/participant-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const session = await getOrCreateParticipantSession();
  const { searchParams } = new URL(request.url);
  const rawPickupId = searchParams.get("pickup_spot_id") ?? searchParams.get("spot");
  const pickupSpotId = rawPickupId?.trim() ?? null;

  if (pickupSpotId === "") {
    return attachParticipantSession(jsonNoStore(
      { error: { code: "INVALID_PICKUP_SPOT", message: "승차 지점을 확인해주세요." } },
      400,
    ), session);
  }

  const catalog = await loadActiveCatalog(pickupSpotId);

  switch (catalog.kind) {
    case "pickup_not_found":
      return attachParticipantSession(jsonNoStore(
        { error: { code: "PICKUP_SPOT_UNAVAILABLE", message: "사용할 수 없는 승차 지점입니다." } },
        404,
      ), session);
    case "database_error":
      return attachParticipantSession(jsonNoStore(
        { error: { code: "CATALOG_UNAVAILABLE", message: "목록을 불러오지 못했습니다." } },
        503,
      ), session);
    case "ok":
      return attachParticipantSession(jsonNoStore({
        pickup_spots: catalog.pickups,
        selected_pickup_id: catalog.selectedPickupId,
        drop_zones: catalog.routes,
      }), session);
  }
}
