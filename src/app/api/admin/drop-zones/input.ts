export type FareInput = {
  readonly pickup_spot_id: string;
  readonly fare_min: number;
  readonly fare_max: number;
  readonly ride_minutes: number;
};

export const DROP_ZONE_STATUSES = ["draft", "active", "inactive"] as const;
export type DropZoneStatus = (typeof DROP_ZONE_STATUSES)[number];

export function parseDropZoneStatus(value: unknown): DropZoneStatus | null {
  if (value === "draft" || value === "active" || value === "inactive") return value;
  return null;
}

export function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

export function readInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function parseFare(value: unknown): FareInput | null {
  if (!isRecord(value)) return null;

  const pickupSpotId = readText(Reflect.get(value, "pickup_spot_id"), 48);
  const fareMin = readInteger(Reflect.get(value, "fare_min"), 1, 100_000);
  const fareMax = readInteger(Reflect.get(value, "fare_max"), 1, 100_000);
  const rideMinutes = readInteger(Reflect.get(value, "ride_minutes"), 1, 180);

  if (!pickupSpotId || fareMin === null || fareMax === null || fareMax < fareMin || rideMinutes === null) {
    return null;
  }

  return {
    pickup_spot_id: pickupSpotId,
    fare_min: fareMin,
    fare_max: fareMax,
    ride_minutes: rideMinutes,
  };
}

export function parseFares(value: unknown): readonly FareInput[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const fares = value.map(parseFare);
  if (fares.some((fare) => fare === null)) return null;

  const parsedFares = fares.filter((fare): fare is FareInput => fare !== null);
  const ids = new Set(parsedFares.map((fare) => fare.pickup_spot_id));
  return ids.size === parsedFares.length ? parsedFares : null;
}

export function isDropZoneId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(value);
}
