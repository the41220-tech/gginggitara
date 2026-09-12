import { createAdminClient } from "@/lib/supabase/server";
import { isValidUUID, sanitizeErrorMessage } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import { requireParticipantSession } from "@/lib/participant-session";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const matchTransitionSchema = z.strictObject({
  action: z.enum(["arrive", "depart"]),
});

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await context.params;
  if (!isValidUUID(id)) {
    return jsonNoStore({ error: "Invalid match ID." }, 400);
  }
  const sessionId = await requireParticipantSession();
  if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);

  try {
    const supabase = await createAdminClient();
    const [matchResult, membershipResult] = await Promise.all([
      supabase
        .from("matches")
        .select(`
          id, team_number, service_date, pickup_spot_id, drop_zone_id,
          total_party_size, eta_minutes, est_fare_min, est_fare_max,
          assembly_deadline, offer_expires_at, offer_version, route_snapshot,
          policy_version, status, created_at,
          pickup:pickup_spots(name, location_desc),
          drop_zone:drop_zones(name, description, walk_minutes),
          members:queue_entries(id, nickname, party_size, status, departure_mode)
        `)
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("queue_entries")
        .select("id")
        .eq("match_id", id)
        .eq("session_id", sessionId)
        .maybeSingle(),
    ]);
    const { data: match, error: matchError } = matchResult;
    const { data: membership, error: membershipError } = membershipResult;
    if (matchError || membershipError) {
      return jsonNoStore({ error: sanitizeErrorMessage(matchError ?? membershipError) }, 500);
    }
    if (!match) return jsonNoStore({ error: "Match not found." }, 404);
    if (!membership) return jsonNoStore({ error: "Not a member of this match." }, 403);

    return jsonNoStore({ ...match, viewer_entry_id: membership.id, server_now: new Date().toISOString() });
  } catch (error) {
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}

export async function PATCH(request: Request, context: { readonly params: Promise<{ readonly id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return jsonNoStore({ error: "Invalid match ID." }, 400);
    }
    const sessionId = await requireParticipantSession();
    if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);
    const body: unknown = await request.json();
    const parsed = matchTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore({ error: "Invalid match transition." }, 400);
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase.rpc("transition_match", {
      p_match_id: id,
      p_session_id: sessionId,
      p_action: parsed.data.action,
    });
    if (error) {
      const status = error.code === "P0002" ? 404 : 409;
      return jsonNoStore({ error: "The match state changed. Refresh and try again." }, status);
    }
    return jsonNoStore(data);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore({ error: "Invalid JSON body." }, 400);
    }
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
