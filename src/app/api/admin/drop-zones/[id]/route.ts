import { createAdminClient } from "@/lib/supabase/server";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { jsonNoStore } from "@/lib/http";
import { isSameOriginRequest } from "@/lib/request-auth";
import { isDropZoneId, isRecord, parseDropZoneStatus, parseFares, readInteger, readText } from "../input";
import type { FareInput } from "../input";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DropZonePatch = {
  readonly name?: string;
  readonly description?: string | null;
  readonly zone_group?: "mid" | "upper";
  readonly walk_minutes?: number;
  readonly display_order?: number;
  readonly status?: "draft" | "active" | "inactive";
  readonly fares?: readonly FareInput[];
};

type DropZoneUpdate = {
  name?: string;
  description?: string | null;
  zone_group?: "mid" | "upper";
  walk_minutes?: number;
  display_order?: number;
  status?: "draft" | "active" | "inactive";
};

function parsePatch(value: unknown): DropZonePatch | null {
  if (!isRecord(value)) return null;
  const patch: DropZoneUpdate & { fares?: readonly FareInput[] } = {};

  if (Reflect.has(value, "name")) {
    const name = readText(Reflect.get(value, "name"), 60);
    if (!name) return null;
    patch.name = name;
  }

  if (Reflect.has(value, "description")) {
    const rawDescription = Reflect.get(value, "description");
    if (rawDescription === null) {
      patch.description = null;
    } else {
      const description = readText(rawDescription, 140);
      if (!description) return null;
      patch.description = description;
    }
  }

  if (Reflect.has(value, "zone_group")) {
    const zoneGroup = Reflect.get(value, "zone_group");
    if (zoneGroup !== "mid" && zoneGroup !== "upper") return null;
    patch.zone_group = zoneGroup;
  }

  if (Reflect.has(value, "walk_minutes")) {
    const walkMinutes = readInteger(Reflect.get(value, "walk_minutes"), 0, 60);
    if (walkMinutes === null) return null;
    patch.walk_minutes = walkMinutes;
  }

  if (Reflect.has(value, "display_order")) {
    const displayOrder = readInteger(Reflect.get(value, "display_order"), 0, 10_000);
    if (displayOrder === null) return null;
    patch.display_order = displayOrder;
  }

  if (Reflect.has(value, "status")) {
    const status = parseDropZoneStatus(Reflect.get(value, "status"));
    if (status === null) return null;
    patch.status = status;
  }

  if (Reflect.has(value, "fares")) {
    const fares = parseFares(Reflect.get(value, "fares"));
    if (fares === null) return null;
    patch.fares = fares;
  }

  return Object.keys(patch).length > 0 ? patch : null;
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

export async function PATCH(request: Request, context: RouteContext<"/api/admin/drop-zones/[id]">) {
  if (!isSameOriginRequest(request)) {
    return jsonNoStore({ error: { code: "INVALID_ORIGIN", message: "요청 출처를 확인해주세요." } }, 403);
  }
  if (!(await hasAdminAccess())) {
    return jsonNoStore({ error: { code: "UNAUTHORIZED", message: "관리자 인증이 필요합니다." } }, 401);
  }

  const { id } = await context.params;
  if (!isDropZoneId(id)) {
    return jsonNoStore(
      { error: { code: "INVALID_DROP_ZONE_ID", message: "하차 지점을 확인해주세요." } },
      400,
    );
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

  const patch = parsePatch(body);
  if (patch === null) {
    return jsonNoStore(
      { error: { code: "INVALID_DROP_ZONE", message: "수정할 하차 지점 정보를 확인해주세요." } },
      400,
    );
  }

  const admin = await createAdminClient();
  const updates: DropZoneUpdate = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.zone_group !== undefined) updates.zone_group = patch.zone_group;
  if (patch.walk_minutes !== undefined) updates.walk_minutes = patch.walk_minutes;
  if (patch.display_order !== undefined) updates.display_order = patch.display_order;
  if (patch.status !== undefined) updates.status = patch.status;

  const { data, error } = await admin.rpc("admin_save_drop_zone", {
    p_id: id,
    p_create: false,
    p_patch: updates,
    p_fares: patch.fares ?? null,
  });

  if (error || data === null) {
    if (error?.code === "P0002") {
      return jsonNoStore(
        { error: { code: "DROP_ZONE_NOT_FOUND", message: "하차 지점을 찾지 못했습니다." } },
        404,
      );
    }
    if (error?.code === "23514") {
      return jsonNoStore(
        { error: { code: "MISSING_FARES", message: "활성 승차 지점의 요금표를 모두 등록해주세요." } },
        422,
      );
    }
    return jsonNoStore(
      { error: { code: "DROP_ZONE_UPDATE_FAILED", message: "하차 지점을 수정하지 못했습니다." } },
      503,
    );
  }

  return jsonNoStore(data);
}
