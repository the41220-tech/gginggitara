import { createAdminClient } from "@/lib/supabase/server";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { jsonNoStore } from "@/lib/http";
import { isSameOriginRequest } from "@/lib/request-auth";
import { isDropZoneId, isRecord, parseDropZoneStatus, parseFares, readInteger, readText } from "./input";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { FareInput } from "./input";

type CreateDropZoneInput = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly zone_group: "mid" | "upper";
  readonly walk_minutes: number;
  readonly display_order: number;
  readonly status: "draft" | "active" | "inactive";
  readonly fares: readonly FareInput[];
};

function parseCreateDropZone(value: unknown): CreateDropZoneInput | null {
  if (!isRecord(value)) return null;

  const id = readText(Reflect.get(value, "id"), 48);
  const name = readText(Reflect.get(value, "name"), 60);
  const rawDescription = Reflect.get(value, "description");
  const description = rawDescription === null || rawDescription === undefined
    ? null
    : readText(rawDescription, 140);
  const zoneGroup = Reflect.get(value, "zone_group");
  const walkMinutes = readInteger(Reflect.get(value, "walk_minutes"), 0, 60);
  const rawDisplayOrder = Reflect.get(value, "display_order");
  const displayOrder = rawDisplayOrder === undefined ? 0 : readInteger(rawDisplayOrder, 0, 10_000);
  const rawStatus = Reflect.get(value, "status");
  const status = rawStatus === undefined ? "draft" : parseDropZoneStatus(rawStatus);
  const rawFares = Reflect.get(value, "fares");
  const fares = rawFares === undefined ? [] : parseFares(rawFares);

  if (
    !id ||
    !isDropZoneId(id) ||
    !name ||
    description === null && rawDescription !== null && rawDescription !== undefined ||
    (zoneGroup !== "mid" && zoneGroup !== "upper") ||
    walkMinutes === null ||
    displayOrder === null ||
    status === null ||
    fares === null
  ) {
    return null;
  }

  return {
    id,
    name,
    description,
    zone_group: zoneGroup,
    walk_minutes: walkMinutes,
    display_order: displayOrder,
    status,
    fares,
  };
}

async function hasAdminAccess(): Promise<boolean> {
  try {
    await requireAdminUser();
    return true;
  } catch (error) {
    if (error instanceof AdminAuthorizationError) return false;
    throw error;
  }
}

export async function GET() {
  if (!(await hasAdminAccess())) {
    return jsonNoStore({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  }

  const admin = await createAdminClient();
  const [zonesResult, pickupsResult, faresResult] = await Promise.all([
    admin
      .from("drop_zones")
      .select("id,name,description,zone_group,walk_minutes,display_order,status,updated_at")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    admin.from("pickup_spots").select("id,name,location_desc,color,active").order("name", { ascending: true }),
    admin
      .from("fare_table")
      .select("pickup_spot_id,drop_zone_id,fare_min,fare_max,ride_minutes")
      .order("pickup_spot_id", { ascending: true }),
  ]);

  if (zonesResult.error || pickupsResult.error || faresResult.error) {
    return jsonNoStore(
      { error: { code: "ADMIN_CATALOG_UNAVAILABLE", message: "관리 목록을 불러오지 못했습니다." } },
      503,
    );
  }

  return jsonNoStore({
    drop_zones: zonesResult.data ?? [],
    pickup_spots: pickupsResult.data ?? [],
    fares: faresResult.data ?? [],
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonNoStore({ error: { code: "INVALID_ORIGIN", message: "요청 출처를 확인해주세요." } }, 403);
  }
  if (!(await hasAdminAccess())) {
    return jsonNoStore({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore(
        { error: { code: "INVALID_JSON", message: "요청 형식을 확인해주세요." } },
        400,
      );
    }
    throw error;
  }

  const input = parseCreateDropZone(body);
  if (input === null) {
    return jsonNoStore(
      { error: { code: "INVALID_DROP_ZONE", message: "하차 지점 정보를 확인해주세요." } },
      400,
    );
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("admin_save_drop_zone", {
    p_id: input.id,
    p_create: true,
    p_patch: {
      name: input.name,
      description: input.description,
      zone_group: input.zone_group,
      walk_minutes: input.walk_minutes,
      display_order: input.display_order,
      status: input.status,
    },
    p_fares: input.fares,
  });

  if (error || data === null) {
    if (error?.code === "23505") {
      return jsonNoStore(
        { error: { code: "DROP_ZONE_EXISTS", message: "이미 사용 중인 하차 지점 ID입니다." } },
        409,
      );
    }
    if (error?.code === "23514") {
      return jsonNoStore(
        { error: { code: "MISSING_FARES", message: "활성 승차 지점의 요금표를 모두 등록해주세요." } },
        422,
      );
    }
    return jsonNoStore(
      { error: { code: "DROP_ZONE_CREATE_FAILED", message: "하차 지점을 만들지 못했습니다." } },
      503,
    );
  }

  return jsonNoStore(data, 201);
}
