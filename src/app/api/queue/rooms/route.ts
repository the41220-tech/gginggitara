import { createAdminClient } from "@/lib/supabase/server";
import { loadActiveCatalog } from "@/lib/catalog";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WaitingEntry = {
  readonly party_size: number;
  readonly drop_zone_id: string;
  readonly departure_mode: "fast" | "cheap";
  readonly created_at: string;
};

function parseWaitingEntry(value: unknown): WaitingEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const partySize = Reflect.get(value, "party_size");
  const dropZoneId = Reflect.get(value, "drop_zone_id");
  const departureMode = Reflect.get(value, "departure_mode");
  const createdAt = Reflect.get(value, "created_at");

  if (
    typeof partySize !== "number" ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    typeof dropZoneId !== "string" ||
    (departureMode !== "fast" && departureMode !== "cheap") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  return {
    party_size: partySize,
    drop_zone_id: dropZoneId,
    departure_mode: departureMode,
    created_at: createdAt,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spot = (searchParams.get("spot") ?? searchParams.get("pickup_spot_id"))?.trim() ?? null;

  if (!spot) {
    return jsonNoStore(
      { error: { code: "INVALID_PICKUP_SPOT", message: "승차 지점을 확인해주세요." } },
      400,
    );
  }

  const catalog = await loadActiveCatalog(spot);
  if (catalog.kind !== "ok") {
    if (catalog.kind === "pickup_not_found") {
      return jsonNoStore(
        { error: { code: "PICKUP_SPOT_UNAVAILABLE", message: "사용할 수 없는 승차 지점입니다." } },
        404,
      );
    }

    return jsonNoStore(
      { error: { code: "CATALOG_UNAVAILABLE", message: "목록을 불러오지 못했습니다." } },
      503,
    );
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("queue_entries")
    .select("party_size,drop_zone_id,departure_mode,created_at")
    .eq("pickup_spot_id", spot)
    .eq("status", "waiting")
    .order("created_at", { ascending: true });

  const grouped = new Map<string, WaitingEntry[]>();
  const liveCountsAvailable = error === null;

  if (error === null) {
    for (const rawEntry of data ?? []) {
      const entry = parseWaitingEntry(rawEntry);
      if (entry === null) continue;

      const entries = grouped.get(entry.drop_zone_id) ?? [];
      entries.push(entry);
      grouped.set(entry.drop_zone_id, entries);
    }
  } else {
    console.error("[queue/rooms] live count query failed", error.code);
  }

  const rooms = catalog.routes.map((route) => {
    const entries = grouped.get(route.id) ?? [];
    const totalPeople = entries.reduce((sum, entry) => sum + entry.party_size, 0);

    return {
      drop_zone_id: route.id,
      zone_name: route.name,
      description: route.description,
      zone_group: route.zone_group,
      walk_minutes: route.walk_minutes,
      display_order: route.display_order,
      fare: route.fare,
      total_people: liveCountsAvailable ? totalPeople : null,
      entry_count: liveCountsAvailable ? entries.length : null,
      fast_count: liveCountsAvailable ? entries.filter((entry) => entry.departure_mode === "fast").length : null,
      cheap_count: liveCountsAvailable ? entries.filter((entry) => entry.departure_mode === "cheap").length : null,
      slots_left: liveCountsAvailable ? Math.max(0, 4 - totalPeople) : null,
    };
  });

  const totalWaiting = [...grouped.values()]
    .flat()
    .reduce((sum, entry) => sum + entry.party_size, 0);

  return jsonNoStore({ rooms, totalWaiting: liveCountsAvailable ? totalWaiting : null, live_counts_available: liveCountsAvailable });
}
