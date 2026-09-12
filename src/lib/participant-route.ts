import { isRecord } from "./api-response";

const WAITING_STATUSES = new Set(["waiting", "offered", "paused"]);
const TEAM_STATUSES = new Set(["matched", "arrived"]);
const TERMINAL_STATUSES = new Set(["expired", "cancelled", "departed", "noshow"]);

export function participantRoute(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return null;

  if (WAITING_STATUSES.has(value.status)) return `/waiting/${value.id}`;
  if (TEAM_STATUSES.has(value.status)) {
    return typeof value.match_id === "string" ? `/team/${value.match_id}` : null;
  }
  return TERMINAL_STATUSES.has(value.status) ? "/result" : null;
}
