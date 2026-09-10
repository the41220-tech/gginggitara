import { triggerAllMatches } from "@/lib/matching";
import { createAdminClient } from "@/lib/supabase/server";
import { sanitizeErrorMessage } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import { requireParticipantSession } from "@/lib/participant-session";

export async function POST() {
  try {
    const sessionId = await requireParticipantSession();
    if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);

    const supabase = await createAdminClient();
    const { data: activeEntry } = await supabase
      .from("queue_entries")
      .select("id")
      .eq("session_id", sessionId)
      .in("status", ["waiting", "offered", "matched", "arrived", "paused"])
      .maybeSingle();
    if (!activeEntry) {
      return jsonNoStore({ error: "Active queue entry not found." }, 404);
    }

    const result = await triggerAllMatches();
    const { data: currentEntry, error } = await supabase
      .from("queue_entries")
      .select(`
        id, nickname, party_size, pickup_spot_id, drop_zone_id,
        departure_mode, status, match_id, queue_deadline_at,
        offer_accepted_at, offer_version,
        match:matches(
          id, team_number, pickup_spot_id, drop_zone_id, total_party_size,
          offer_expires_at, assembly_deadline, status
        )
      `)
      .eq("id", activeEntry.id)
      .single();
    if (error) return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);

    return jsonNoStore({ entry: currentEntry, matching: result });
  } catch (error) {
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
