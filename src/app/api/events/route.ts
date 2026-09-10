import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { jsonNoStore } from "@/lib/http";
import { hashProductEventSession } from "@/lib/server-analytics";
import { attachParticipantSession, getOrCreateParticipantSession } from "@/lib/participant-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const productEventNames = [
  "join_started",
  "drop_zone_selected",
  "matching_started",
  "offer_presented",
  "offer_accepted",
  "offer_declined",
  "team_assembled",
  "arrival_marked",
  "departed",
  "result_viewed",
  "account_copied",
] as const;

const productEventSchema = z.strictObject({
  event_id: z.uuid(),
  event_name: z.enum(productEventNames),
  properties: z.strictObject({
    drop_zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/).optional(),
    party_size: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    preference: z.enum(["fast", "cheap"]).optional(),
    waiting_bucket: z.enum(["under_1m", "1_to_3m", "over_3m"]).optional(),
    network_type: z.enum(["slow-2g", "2g", "3g", "4g", "5g", "unknown"]).optional(),
    latency: z.number().int().min(0).max(300_000).optional(),
    result_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
  }).default({}),
});

function eventHashSalt(): string | null {
  const salt = process.env.EVENT_HASH_SALT?.trim();
  return salt && salt.length >= 32 ? salt : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore({ error: { code: "INVALID_JSON", message: "요청 형식을 확인해주세요." } }, 400);
    }
    throw error;
  }

  const parsed = productEventSchema.safeParse(body);
  if (!parsed.success) {
    return jsonNoStore({ error: { code: "INVALID_EVENT", message: "허용되지 않은 이벤트입니다." } }, 400);
  }

  const session = await getOrCreateParticipantSession();

  const salt = eventHashSalt();
  if (!salt) {
    return jsonNoStore({ error: { code: "EVENTS_UNAVAILABLE", message: "이벤트 수집을 사용할 수 없습니다." } }, 503);
  }

  const admin = await createAdminClient();
  const { error } = await admin.from("product_events").upsert({
    event_id: parsed.data.event_id,
    event_name: parsed.data.event_name,
    event_source: "client",
    session_hash: hashProductEventSession(session.id, salt),
    properties: parsed.data.properties,
  }, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) {
    return jsonNoStore({ error: { code: "EVENT_WRITE_FAILED", message: "이벤트를 저장하지 못했습니다." } }, 503);
  }

  return attachParticipantSession(jsonNoStore({ accepted: true }, 202), session);
}
