"use client";

import { sendGaEvent } from "@/lib/ga";

export const PRODUCT_EVENT_NAMES = [
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

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export type ProductEventProperties = Readonly<{
  drop_zone_id?: string;
  party_size?: 1 | 2 | 3;
  preference?: "fast" | "cheap";
  waiting_bucket?: "under_1m" | "1_to_3m" | "over_3m";
  network_type?: "slow-2g" | "2g" | "3g" | "4g" | "5g" | "unknown";
  latency?: number;
  result_code?: string;
}>;

export type ProductEventInput = Readonly<{
  eventName: ProductEventName;
  properties?: ProductEventProperties;
}>;

function eventId(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return null;
  return crypto.randomUUID();
}

function postInBackground(payload: string): void {
  const body = new Blob([payload], { type: "application/json" });
  if (navigator.sendBeacon("/api/events", body)) return;

  void fetch("/api/events", {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

export function trackProductEvent(input: ProductEventInput): void {
  if (typeof window === "undefined") return;
  const id = eventId();
  if (!id) return;

  postInBackground(JSON.stringify({
    event_id: id,
    event_name: input.eventName,
    properties: input.properties ?? {},
  }));
  sendGaEvent(input.eventName, input.properties);
}
