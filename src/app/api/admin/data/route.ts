import { createAdminClient } from "@/lib/supabase/server";
import { sanitizeErrorMessage } from "@/lib/validation";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 관리자 대시보드 데이터 API
 * RLS 강화 후 클라이언트에서 직접 DB 조회가 불가능하므로,
 * 인증된 관리자만 server-side에서 service_role로 데이터를 조회합니다.
 */
export async function GET() {
  try {
    await requireAdminUser();

    const admin = await createAdminClient();

    const queueSelect = "id,nickname,party_size,pickup_spot_id,drop_zone_id,departure_mode,status,created_at";
    const [queueResult, matchResult, reportResult, fareResult, pickupResult, dropZoneResult] = await Promise.all([
      admin.from("queue_entries").select(queueSelect).order("created_at", { ascending: false }).limit(20),
      admin.from("matches").select(`id,team_number,pickup_spot_id,drop_zone_id,total_party_size,status,created_at,members:queue_entries(${queueSelect})`).order("created_at", { ascending: false }).limit(20),
      admin.from("reports").select("id,type,description,created_at").order("created_at", { ascending: false }).limit(20),
      admin.from("fare_table").select("pickup_spot_id,drop_zone_id,fare_min,fare_max,ride_minutes,pickup_spots(name),drop_zones(name)"),
      admin.from("pickup_spots").select("id,name,location_desc,color,active").order("name", { ascending: true }),
      admin
        .from("drop_zones")
        .select("id,name,description,zone_group,walk_minutes,display_order,status,updated_at")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [matchCount, matchCountToday, userCount, noshowCount, waitingEntries] = await Promise.all([
      admin.from("matches").select("id", { count: "exact", head: true }),
      admin.from("matches").select("id", { count: "exact", head: true }).eq("service_date", kstDate),
      admin.from("queue_entries").select("id", { count: "exact", head: true }),
      admin.from("queue_entries").select("id", { count: "exact", head: true }).eq("status", "noshow"),
      admin.from("queue_entries").select("party_size,priority_at").eq("status", "waiting").order("priority_at", { ascending: true }),
    ]);

    if (
      queueResult.error ||
      matchResult.error ||
      reportResult.error ||
      fareResult.error ||
      pickupResult.error ||
      dropZoneResult.error ||
      matchCount.error ||
      matchCountToday.error ||
      userCount.error ||
      noshowCount.error ||
      waitingEntries.error
    ) {
      return jsonNoStore(
        { error: { code: "ADMIN_DATA_UNAVAILABLE", message: "운영 데이터를 불러오지 못했습니다." } },
        503,
      );
    }

    return jsonNoStore({
      queue: queueResult.data || [],
      matches: matchResult.data || [],
      reports: reportResult.data || [],
      fares: fareResult.data || [],
      pickup_spots: pickupResult.data || [],
      drop_zones: dropZoneResult.data || [],
      stats: {
        matches: matchCount.count || 0,
        matches_today: matchCountToday.count || 0,
        users: userCount.count || 0,
        noshows: noshowCount.count || 0,
        current_waiting_people: (waitingEntries.data ?? []).reduce((sum, entry) => sum + (typeof entry.party_size === "number" ? entry.party_size : 0), 0),
        oldest_waiting_at: waitingEntries.data?.[0]?.priority_at ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return jsonNoStore(
        { error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } },
        401,
      );
    }

    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
