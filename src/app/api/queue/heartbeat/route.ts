import { createAdminClient } from "@/lib/supabase/server";
import { sanitizeErrorMessage } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import { requireParticipantSession } from "@/lib/participant-session";

export async function POST() {
  try {
    const sessionId = await requireParticipantSession();
    if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);

    const serverNow = new Date().toISOString();
    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("queue_entries")
      .update({ last_active_at: serverNow })
      .eq("session_id", sessionId)
      .in("status", ["waiting", "offered", "matched", "arrived", "paused"])
      .select("id, status, match_id, queue_deadline_at, offer_version")
      .maybeSingle();

    if (error) return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
    return jsonNoStore(data
      ? { active: true, entry: data, server_now: serverNow }
      : { active: false, server_now: serverNow });
  } catch (error) {
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
