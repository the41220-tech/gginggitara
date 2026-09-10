import "server-only";

import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

type ServerProductEvent = Readonly<{
  eventName: "settlement_created";
  sessionId: string;
  properties: Readonly<{
    party_size: number;
  }>;
}>;

function eventHashSalt(): string | null {
  const salt = process.env.EVENT_HASH_SALT?.trim();
  return salt && salt.length >= 32 ? salt : null;
}

export function hashProductEventSession(sessionId: string, salt: string): string {
  return createHmac("sha256", salt).update(sessionId).digest("hex");
}

export async function recordServerProductEvent(event: ServerProductEvent): Promise<void> {
  const salt = eventHashSalt();
  if (!salt) return;

  try {
    const admin = await createAdminClient();
    await admin.from("product_events").insert({
      event_name: event.eventName,
      event_source: "server",
      session_hash: hashProductEventSession(event.sessionId, salt),
      properties: event.properties,
    });
  } catch {
  }
}
