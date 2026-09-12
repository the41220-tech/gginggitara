import { apiMessage, isRecord } from "./api-response";
import { participantFetch } from "./client-session";
import { participantRoute } from "./participant-route";

type ParticipantFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function needsTeamRecovery(response: Pick<Response, "status" | "ok">, payload: unknown): boolean {
  return response.status === 403 || response.status === 404
    || (response.ok && isRecord(payload) && payload.status === "cancelled");
}

export async function recoverTeamRoute(
  currentMatchId: string,
  fetcher: ParticipantFetcher = participantFetch,
): Promise<string> {
  const response = await fetcher("/api/queue", { method: "GET", cache: "no-store" });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(apiMessage(payload, "현재 참여 상태를 불러오지 못했어요."));
  if (payload === null) return "/join";
  const route = participantRoute(payload);
  // Never loop back to a match that just rejected this participant.
  if (!route || route === `/team/${currentMatchId}`) {
    throw new Error("현재 참여 상태를 확인하지 못했어요. 다시 확인해주세요.");
  }
  return route;
}
