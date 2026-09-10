import { createAdminClient } from "@/lib/supabase/server";
import { loadActiveCatalog } from "@/lib/catalog";
import { jsonNoStore } from "@/lib/http";
import { requireParticipantSession } from "@/lib/participant-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spot = (searchParams.get("spot") ?? searchParams.get("pickup_spot_id"))?.trim() ?? null;
  const zone = (searchParams.get("zone") ?? searchParams.get("drop_zone_id"))?.trim() ?? null;

  if (!spot || !zone) {
    return jsonNoStore(
      { error: { code: "INVALID_ROUTE", message: "승차 및 하차 지점을 확인해주세요." } },
      400,
    );
  }

  const catalog = await loadActiveCatalog(spot);
  if (catalog.kind === "database_error") {
    return jsonNoStore(
      { error: { code: "CATALOG_UNAVAILABLE", message: "경로 목록을 불러오지 못했습니다." } },
      503,
    );
  }
  if (catalog.kind !== "ok" || !catalog.routes.some((route) => route.id === zone)) {
    return jsonNoStore(
      { error: { code: "ROUTE_UNAVAILABLE", message: "사용할 수 없는 경로입니다." } },
      404,
    );
  }

  const sessionId = await requireParticipantSession();
  const admin = await createAdminClient();
  let routeQuery = admin
    .from("queue_entries")
    .select("party_size")
    .eq("pickup_spot_id", spot)
    .eq("drop_zone_id", zone)
    .eq("status", "waiting");

  if (sessionId) routeQuery = routeQuery.neq("session_id", sessionId);

  const [sameRouteResult, totalResult, sameSpotResult] = await Promise.all([
    routeQuery,
    admin
      .from("queue_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "waiting"),
    admin
      .from("queue_entries")
      .select("party_size")
      .eq("pickup_spot_id", spot)
      .eq("status", "waiting"),
  ]);

  if (sameRouteResult.error || totalResult.error || sameSpotResult.error) {
    return jsonNoStore(
      { error: { code: "LIVE_COUNTS_UNAVAILABLE", message: "대기 인원을 확인하지 못했습니다." } },
      503,
    );
  }

  const routePartySizes = (sameRouteResult.data ?? []).flatMap((row) =>
    typeof row.party_size === "number" && Number.isInteger(row.party_size) && row.party_size > 0
      ? [row.party_size]
      : [],
  );
  const spotPartySizes = (sameSpotResult.data ?? []).flatMap((row) =>
    typeof row.party_size === "number" && Number.isInteger(row.party_size) && row.party_size > 0
      ? [row.party_size]
      : [],
  );

  return jsonNoStore({
    count: routePartySizes.length,
    people: routePartySizes.reduce((sum, partySize) => sum + partySize, 0),
    spotPeople: spotPartySizes.reduce((sum, partySize) => sum + partySize, 0),
    totalEntries: totalResult.count ?? 0,
    live_counts_available: true,
  });
}
