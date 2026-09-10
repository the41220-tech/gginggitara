import { createAdminClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type CatalogPickup = {
  readonly id: string;
  readonly name: string;
  readonly location_desc: string;
  readonly color: string;
};

export type CatalogFare = {
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly fare_min: number;
  readonly fare_max: number;
  readonly ride_minutes: number;
};

export type CatalogDropZone = {
  readonly id: string;
  readonly name: string;
  readonly zone_group: string;
  readonly walk_minutes: number;
  readonly description: string | null;
  readonly display_order: number;
};

export type CatalogRoute = CatalogDropZone & {
  readonly fare: CatalogFare;
};

export type CatalogResult = {
  readonly kind: "ok";
  readonly pickups: readonly CatalogPickup[];
  readonly selectedPickupId: string | null;
  readonly routes: readonly CatalogRoute[];
};

export type CatalogFailure = {
  readonly kind: "pickup_not_found" | "database_error";
};

export type ActiveCatalog = CatalogResult | CatalogFailure;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parsePickup(value: unknown): CatalogPickup | null {
  if (!isRecord(value)) return null;

  const id = readText(value.id);
  const name = readText(value.name);
  const locationDesc = readText(value.location_desc);
  const color = readText(value.color);

  if (!id || !name || !locationDesc || !color) return null;

  return { id, name, location_desc: locationDesc, color };
}

function parseDropZone(value: unknown): CatalogDropZone | null {
  if (!isRecord(value)) return null;

  const id = readText(value.id);
  const name = readText(value.name);
  const zoneGroup = readText(value.zone_group);
  const walkMinutes = readInteger(value.walk_minutes);
  const displayOrder = readInteger(value.display_order);
  const description = value.description;

  if (
    !id ||
    !name ||
    !zoneGroup ||
    walkMinutes === null ||
    walkMinutes < 0 ||
    displayOrder === null ||
    displayOrder < 0 ||
    (description !== null && typeof description !== "string")
  ) {
    return null;
  }

  return {
    id,
    name,
    zone_group: zoneGroup,
    walk_minutes: walkMinutes,
    description,
    display_order: displayOrder,
  };
}

export function parseCompleteFare(value: unknown): CatalogFare | null {
  if (!isRecord(value)) return null;

  const pickupSpotId = readText(value.pickup_spot_id);
  const dropZoneId = readText(value.drop_zone_id);
  const fareMin = readInteger(value.fare_min);
  const fareMax = readInteger(value.fare_max);
  const rideMinutes = readInteger(value.ride_minutes);

  if (
    !pickupSpotId ||
    !dropZoneId ||
    fareMin === null ||
    fareMax === null ||
    rideMinutes === null ||
    fareMin <= 0 ||
    fareMax < fareMin ||
    rideMinutes <= 0
  ) {
    return null;
  }

  return {
    pickup_spot_id: pickupSpotId,
    drop_zone_id: dropZoneId,
    fare_min: fareMin,
    fare_max: fareMax,
    ride_minutes: rideMinutes,
  };
}

export async function loadActiveCatalog(
  pickupSpotId: string | null,
): Promise<ActiveCatalog> {
  const admin = await createAdminClient();
  const { data: pickupRows, error: pickupError } = await admin
    .from("pickup_spots")
    .select("id,name,location_desc,color")
    .eq("active", true)
    .order("name", { ascending: true });

  if (pickupError) return { kind: "database_error" };

  const pickups = (pickupRows ?? [])
    .map(parsePickup)
    .filter((pickup): pickup is CatalogPickup => pickup !== null);

  if (pickupSpotId === null) {
    return { kind: "ok", pickups, selectedPickupId: null, routes: [] };
  }

  if (!pickups.some((pickup) => pickup.id === pickupSpotId)) {
    return { kind: "pickup_not_found" };
  }

  const [zoneResult, fareResult] = await Promise.all([
    admin
      .from("drop_zones")
      .select("id,name,zone_group,walk_minutes,description,display_order")
      .eq("status", "active")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("fare_table")
      .select("pickup_spot_id,drop_zone_id,fare_min,fare_max,ride_minutes")
      .eq("pickup_spot_id", pickupSpotId),
  ]);

  if (zoneResult.error || fareResult.error) return { kind: "database_error" };

  const fares = (fareResult.data ?? [])
    .map(parseCompleteFare)
    .filter((fare): fare is CatalogFare => fare !== null);
  const faresByZone = new Map(fares.map((fare) => [fare.drop_zone_id, fare]));
  const routes: CatalogRoute[] = [];

  for (const rawZone of zoneResult.data ?? []) {
    const zone = parseDropZone(rawZone);
    if (zone === null) continue;

    const fare = faresByZone.get(zone.id);
    if (fare) routes.push({ ...zone, fare });
  }

  return { kind: "ok", pickups, selectedPickupId: pickupSpotId, routes };
}

export async function loadActivePickupIds(): Promise<
  | { readonly kind: "ok"; readonly ids: readonly string[] }
  | { readonly kind: "database_error" }
> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("pickup_spots")
    .select("id")
    .eq("active", true);

  if (error) return { kind: "database_error" };

  const ids = (data ?? [])
    .map((row) => (isRecord(row) ? readText(row.id) : null))
    .filter((id): id is string => id !== null);

  return { kind: "ok", ids };
}
