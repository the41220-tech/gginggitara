import { apiMessage } from "./api-response";
import { participantFetch } from "./client-session";
import { participantRoute } from "./participant-route";

type ParticipantFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function advanceParticipantMatching(
  fetcher: ParticipantFetcher = participantFetch,
): Promise<string | null> {
  const response = await fetcher("/api/match/countdown", { method: "POST" });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(apiMessage(payload, "매칭 상태를 갱신하지 못했어요."));
  }
  return participantRoute(
    typeof payload === "object" && payload !== null && "entry" in payload
      ? payload.entry
      : null,
  );
}
