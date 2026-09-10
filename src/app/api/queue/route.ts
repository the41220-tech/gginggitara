import { MatchingEngineError, triggerAllMatches } from "@/lib/matching";
import { generateNickname } from "@/lib/nickname";
import { createAdminClient } from "@/lib/supabase/server";
import { sanitizeErrorMessage } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import {
  attachParticipantSession,
  getOrCreateParticipantSession,
  requireParticipantSession,
} from "@/lib/participant-session";
import type { ParticipantSession } from "@/lib/participant-session";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUEUE_SELECT = `
  id, nickname, party_size, pickup_spot_id, drop_zone_id, departure_mode,
  status, match_id, noshow_count, last_active_at, priority_at,
  queue_deadline_at, offered_at, offer_accepted_at, offer_version,
  policy_version, created_at,
  pickup:pickup_spots(id, name, location_desc),
  drop_zone:drop_zones(id, name, description, walk_minutes),
  match:matches(
    id, team_number, pickup_spot_id, drop_zone_id, total_party_size,
    eta_minutes, est_fare_min, est_fare_max, service_date,
    offer_expires_at, offer_version, route_snapshot, policy_version,
    assembly_deadline, status, created_at
  )
`;

const queueRequestSchema = z.strictObject({
  party_size: z.number().int().min(1).max(3),
  pickup_spot_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
  drop_zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
  departure_mode: z.enum(["fast", "cheap"]),
});

export async function POST(request: Request) {
  let participantSession: ParticipantSession | null = null;
  const respond = (body: unknown, status = 200) => {
    const response = jsonNoStore(body, status);
    return participantSession ? attachParticipantSession(response, participantSession) : response;
  };

  try {
    const body: unknown = await request.json();
    const parsed = queueRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respond({ error: "Invalid queue request." }, 400);
    }
    participantSession = await getOrCreateParticipantSession();
    const queueRequest = parsed.data;

    const supabase = await createAdminClient();
    const { data: blocked } = await supabase
      .from("blocked_sessions")
      .select("blocked_until")
      .eq("session_id", participantSession.id)
      .gt("blocked_until", new Date().toISOString())
      .maybeSingle();
    if (blocked) {
      return respond(
        { error: "This session is temporarily blocked.", blocked_until: blocked.blocked_until },
        403,
      );
    }

    const { data: existing } = await supabase
      .from("queue_entries")
      .select(QUEUE_SELECT)
      .eq("session_id", participantSession.id)
      .in("status", ["waiting", "offered", "matched", "arrived", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return respond({ ...existing, resumed: true, server_now: new Date().toISOString() });
    }

    const [{ data: pickup }, { data: dropZone }, { data: fare }] = await Promise.all([
      supabase.from("pickup_spots").select("id").eq("id", queueRequest.pickup_spot_id).eq("active", true).maybeSingle(),
      supabase.from("drop_zones").select("id").eq("id", queueRequest.drop_zone_id).eq("status", "active").maybeSingle(),
      supabase
        .from("fare_table")
        .select("pickup_spot_id")
        .eq("pickup_spot_id", queueRequest.pickup_spot_id)
        .eq("drop_zone_id", queueRequest.drop_zone_id)
        .maybeSingle(),
    ]);
    if (!pickup || !dropZone || !fare) {
      return respond({ error: "This route is not available." }, 400);
    }

    const now = new Date();
    const queueDeadline = new Date(now.getTime() + 3 * 60 * 1000);
    const { data: queueEntry, error } = await supabase
      .from("queue_entries")
      .insert({
        session_id: participantSession.id,
        nickname: generateNickname(),
        party_size: queueRequest.party_size,
        pickup_spot_id: queueRequest.pickup_spot_id,
        drop_zone_id: queueRequest.drop_zone_id,
        departure_mode: queueRequest.departure_mode,
        status: "waiting",
        priority_at: now.toISOString(),
        queue_deadline_at: queueDeadline.toISOString(),
      })
      .select("id")
      .single();

    if (error || !queueEntry) {
      if (error?.code === "23505") {
        const { data: racedEntry } = await supabase
          .from("queue_entries")
          .select(QUEUE_SELECT)
          .eq("session_id", participantSession.id)
          .in("status", ["waiting", "offered", "matched", "arrived", "paused"])
          .maybeSingle();
        if (racedEntry) {
          return respond({ ...racedEntry, resumed: true });
        }
      }
      return respond({ error: sanitizeErrorMessage(error) }, 500);
    }

    let matchingPending = false;
    try {
      await triggerAllMatches();
    } catch (error) {
      if (!(error instanceof MatchingEngineError)) throw error;
      matchingPending = true;
    }

    const { data: currentEntry, error: currentEntryError } = await supabase
      .from("queue_entries")
      .select(QUEUE_SELECT)
      .eq("id", queueEntry.id)
      .single();

    if (currentEntryError || !currentEntry) {
      return respond({ id: queueEntry.id, matching_pending: true, server_now: new Date().toISOString() }, 202);
    }

    return respond({
      ...currentEntry,
      matching_pending: matchingPending,
      server_now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return respond({ error: "Invalid JSON body." }, 400);
    }
    return respond({ error: sanitizeErrorMessage(error) }, 500);
  }
}

export async function GET() {
  const sessionId = await requireParticipantSession();
  if (!sessionId) return jsonNoStore({ error: "Participant session required." }, 401);

  try {
    const supabase = await createAdminClient();
    let { data, error } = await supabase
      .from("queue_entries")
      .select(QUEUE_SELECT)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);

    const now = Date.now();
    let needsAdvance = data?.status === "waiting" && Date.parse(data.queue_deadline_at) <= now;
    if (!needsAdvance && data?.match_id && ["offered", "matched", "arrived"].includes(data.status)) {
      const { data: relatedMatch, error: relatedMatchError } = await supabase
        .from("matches")
        .select("status,offer_expires_at,assembly_deadline")
        .eq("id", data.match_id)
        .maybeSingle();
      if (relatedMatchError) return jsonNoStore({ error: sanitizeErrorMessage(relatedMatchError) }, 500);
      const deadline = relatedMatch?.status === "offered" ? relatedMatch.offer_expires_at : relatedMatch?.assembly_deadline;
      needsAdvance = Boolean(deadline && Date.parse(deadline) <= now);
    }

    if (needsAdvance) {
      await triggerAllMatches();
      const refreshed = await supabase
        .from("queue_entries")
        .select(QUEUE_SELECT)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      data = refreshed.data;
      error = refreshed.error;
      if (error) return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
    }

    return jsonNoStore(data ? { ...data, server_now: new Date().toISOString() } : null);
  } catch (error) {
    return jsonNoStore({ error: sanitizeErrorMessage(error) }, 500);
  }
}
