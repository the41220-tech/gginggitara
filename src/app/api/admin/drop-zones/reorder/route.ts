import { createAdminClient } from "@/lib/supabase/server";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import { jsonNoStore } from "@/lib/http";
import { isSameOriginRequest } from "@/lib/request-auth";
import { isDropZoneId, isRecord, readInteger } from "../input";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReorderItem = {
  readonly id: string;
  readonly display_order: number;
};

function parseReorder(value: unknown): readonly ReorderItem[] | null {
  if (!isRecord(value)) return null;
  const items = Reflect.get(value, "items");
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return null;

  const parsedItems = items.map((item) => {
    if (!isRecord(item)) return null;
    const id = Reflect.get(item, "id");
    const displayOrder = readInteger(Reflect.get(item, "display_order"), 0, 10_000);
    return typeof id === "string" && isDropZoneId(id) && displayOrder !== null
      ? { id, display_order: displayOrder }
      : null;
  });

  if (parsedItems.some((item) => item === null)) return null;
  const result = parsedItems.filter((item): item is ReorderItem => item !== null);
  const ids = new Set(result.map((item) => item.id));
  const orders = new Set(result.map((item) => item.display_order));
  return ids.size === result.length && orders.size === result.length ? result : null;
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

export async function PATCH(request: Request) {
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

  const items = parseReorder(body);
  if (items === null) {
    return jsonNoStore(
      { error: { code: "INVALID_REORDER", message: "표시 순서를 확인해주세요." } },
      400,
    );
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("admin_reorder_drop_zones", { p_items: items });

  if (error?.code === "P0002") {
    return jsonNoStore(
      { error: { code: "DROP_ZONE_NOT_FOUND", message: "존재하지 않는 하차 지점이 있습니다." } },
      404,
    );
  }
  if (error || data === null) {
    return jsonNoStore(
      { error: { code: "DROP_ZONE_REORDER_FAILED", message: "표시 순서를 저장하지 못했습니다." } },
      503,
    );
  }

  return jsonNoStore(data);
}
