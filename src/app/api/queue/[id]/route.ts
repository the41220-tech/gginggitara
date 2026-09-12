import { MatchingEngineError, triggerAllMatches } from "@/lib/matching";
import { shouldTriggerMatchesAfterTransition, triggerMatchesBestEffort } from "@/lib/matching-trigger-policy";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidUUID, sanitizeErrorMessage } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import { requireParticipantSession } from "@/lib/participant-session";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const queueTransitionSchema = z.strictObject({
  action: z.enum(["accept", "decline", "cancel", "resume", "arrived"]),
  offer_version: z.number().int().nonnegative().nullable().default(null),
});

export async function PATCH(request: Request, context: RouteContext<"/api/queue/[id]">) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return jsonNoStore({ error: "Invalid entry ID." }, 400);
    }
    const sessionId = await requireParticipantSession();
    if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);

    const body: unknown = await request.json();
    const parsed = queueTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore({ error: "Invalid queue transition." }, 400);
    }
    const transition = parsed.data;

    const supabase = await createAdminClient();
    if (transition.action === "arrived") {
      const { data: entry } = await supabase
        .from("queue_entries")
        .select("match_id")
        .eq("id", id)
        .eq("session_id", sessionId)
        .maybeSingle();
      if (!entry?.match_id) {
        return jsonNoStore({ error: "Active match not found." }, 404);
      }
      const { data, error } = await supabase.rpc("transition_match", {
        p_match_id: entry.match_id,
        p_session_id: sessionId,
        p_action: "arrive",
      });
      if (error) return jsonNoStore({ error: "Cannot mark arrival in the current state." }, 409);
      return jsonNoStore(data);
    }

    const { data, error } = await supabase.rpc("transition_queue_entry", {
      p_entry_id: id,
      p_session_id: sessionId,
      p_action: transition.action,
      p_offer_version: transition.offer_version,
    });
    if (error) {
      const status = error.code === "P0002" ? 404 : 409;
      return jsonNoStore({ error: "The queue state changed. Refresh and try again." }, status);
    }

    const matchingPending = shouldTriggerMatchesAfterTransition(transition.action)
      ? await triggerMatchesBestEffort(
          () => triggerAllMatches(),
          (matchingError) => matchingError instanceof MatchingEngineError,
        )
      : false;
    return jsonNoStore({ ...data, matching_pending: matchingPending });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore({ error: "Invalid JSON body." }, 400);
    }
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
