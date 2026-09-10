import type { AdminDashboardData, AdminDropZone, AdminFare, AdminMatch, AdminPickup, AdminQueueEntry, AdminReport } from "./types";

export type ApiResult<T> =
  | { readonly kind: "ok"; readonly data: T }
  | { readonly kind: "unauthorized"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function integer(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function bool(record: JsonRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function parsePickup(value: unknown): AdminPickup | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id");
  const name = text(value, "name");
  const locationDesc = text(value, "location_desc");
  const active = bool(value, "active");
  return id && name && locationDesc && active !== null ? { id, name, location_desc: locationDesc, active } : null;
}

function parseDropZone(value: unknown): AdminDropZone | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id");
  const name = text(value, "name");
  const description = value.description === null ? null : text(value, "description");
  const zoneGroup = text(value, "zone_group");
  const walkMinutes = integer(value, "walk_minutes");
  const displayOrder = integer(value, "display_order");
  const status = text(value, "status");
  if (!id || !name || description === undefined || (zoneGroup !== "mid" && zoneGroup !== "upper") || walkMinutes === null || displayOrder === null || (status !== "draft" && status !== "active" && status !== "inactive")) return null;
  return { id, name, description, zone_group: zoneGroup, walk_minutes: walkMinutes, display_order: displayOrder, status };
}

function parseFare(value: unknown): AdminFare | null {
  if (!isRecord(value)) return null;
  const pickupSpotId = text(value, "pickup_spot_id");
  const dropZoneId = text(value, "drop_zone_id");
  const fareMin = integer(value, "fare_min");
  const fareMax = integer(value, "fare_max");
  const rideMinutes = integer(value, "ride_minutes");
  return pickupSpotId && dropZoneId && fareMin !== null && fareMax !== null && rideMinutes !== null ? { pickup_spot_id: pickupSpotId, drop_zone_id: dropZoneId, fare_min: fareMin, fare_max: fareMax, ride_minutes: rideMinutes } : null;
}

function parseQueueEntry(value: unknown): AdminQueueEntry | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id");
  const nickname = text(value, "nickname");
  const partySize = integer(value, "party_size");
  const pickupSpotId = text(value, "pickup_spot_id");
  const dropZoneId = text(value, "drop_zone_id");
  const departureMode = text(value, "departure_mode");
  const status = text(value, "status");
  const createdAt = text(value, "created_at");
  return id && nickname && partySize !== null && pickupSpotId && dropZoneId && departureMode && status && createdAt ? { id, nickname, party_size: partySize, pickup_spot_id: pickupSpotId, drop_zone_id: dropZoneId, departure_mode: departureMode, status, created_at: createdAt } : null;
}

function parseMatch(value: unknown): AdminMatch | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id");
  const teamNumber = integer(value, "team_number");
  const pickupSpotId = text(value, "pickup_spot_id");
  const dropZoneId = text(value, "drop_zone_id");
  const totalPartySize = integer(value, "total_party_size");
  const status = text(value, "status");
  const createdAt = text(value, "created_at");
  const members = Array.isArray(value.members) ? value.members.map(parseQueueEntry).filter((member): member is AdminQueueEntry => member !== null) : [];
  return id && teamNumber !== null && pickupSpotId && dropZoneId && totalPartySize !== null && status && createdAt ? { id, team_number: teamNumber, pickup_spot_id: pickupSpotId, drop_zone_id: dropZoneId, total_party_size: totalPartySize, status, created_at: createdAt, members } : null;
}

function parseReport(value: unknown): AdminReport | null {
  if (!isRecord(value)) return null;
  const id = text(value, "id");
  const type = text(value, "type");
  const description = value.description === null ? null : text(value, "description");
  const createdAt = text(value, "created_at");
  return id && type && description !== undefined && createdAt ? { id, type, description, created_at: createdAt } : null;
}

function list<T>(value: unknown, parse: (item: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parse);
  return rows.some((row) => row === null) ? null : rows.filter((row): row is T => row !== null);
}

function message(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const nested = value.error;
  if (isRecord(nested)) return text(nested, "message") ?? fallback;
  return text(value, "error") ?? fallback;
}

function parseDashboard(value: unknown): AdminDashboardData | null {
  if (!isRecord(value) || !isRecord(value.stats)) return null;
  const queue = list(value.queue, parseQueueEntry);
  const matches = list(value.matches, parseMatch);
  const reports = list(value.reports, parseReport);
  const fares = list(value.fares, parseFare);
  const pickupSpots = list(value.pickup_spots, parsePickup);
  const dropZones = list(value.drop_zones, parseDropZone);
  const matchCount = integer(value.stats, "matches");
  const matchesToday = integer(value.stats, "matches_today");
  const users = integer(value.stats, "users");
  const noshows = integer(value.stats, "noshows");
  const currentWaitingPeople = integer(value.stats, "current_waiting_people");
  const oldestWaitingAt = value.stats.oldest_waiting_at === null ? null : text(value.stats, "oldest_waiting_at");
  return queue && matches && reports && fares && pickupSpots && dropZones && matchCount !== null && matchesToday !== null && users !== null && noshows !== null && currentWaitingPeople !== null && oldestWaitingAt !== undefined ? { queue, matches, reports, fares, pickup_spots: pickupSpots, drop_zones: dropZones, stats: { matches: matchCount, matches_today: matchesToday, users, noshows, current_waiting_people: currentWaitingPeople, oldest_waiting_at: oldestWaitingAt } } : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function getDashboard(): Promise<ApiResult<AdminDashboardData>> {
  try {
    const response = await fetch("/api/admin/data", { cache: "no-store" });
    const payload: unknown = await readJson(response);
    if (response.status === 401) return { kind: "unauthorized", message: message(payload, "관리자 권한이 필요합니다.") };
    if (!response.ok) return { kind: "error", message: message(payload, "운영 데이터를 불러오지 못했습니다.") };
    const data = parseDashboard(payload);
    return data ? { kind: "ok", data } : { kind: "error", message: "운영 데이터 형식을 확인하지 못했습니다." };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "error", message: "네트워크 연결을 확인해주세요." };
    throw error;
  }
}

export async function sendAdminRequest(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<ApiResult<null>> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const payload: unknown = await readJson(response);
    if (response.status === 401) return { kind: "unauthorized", message: message(payload, "관리자 권한이 필요합니다.") };
    if (!response.ok) return { kind: "error", message: message(payload, "요청을 처리하지 못했습니다.") };
    return { kind: "ok", data: null };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "error", message: "네트워크 연결을 확인해주세요." };
    throw error;
  }
}
