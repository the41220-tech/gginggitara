import { createClient } from "@/lib/supabase/server";

export async function calculateFare(spot_id: string, zone_id: string, party_size: number) {
  const supabase = await createClient();
  const { data: fareData, error } = await supabase
    .from("fare_table")
    .select("*")
    .eq("pickup_spot_id", spot_id)
    .eq("drop_zone_id", zone_id)
    .single();

  if (error || !fareData) {
    // Return some default if not found
    return {
      fare_min: 7000,
      fare_max: 9000,
      per_person_min: 3500,
      per_person_max: 4500,
      ride_minutes: 10,
      eta: 15, // assembly (2-5) + ride (10)
    };
  }

  // Rounding logic as per spec: ₩100 unit rounded up
  const round100 = (num: number) => Math.ceil(num / 100) * 100;

  const fare_min = round100(fareData.fare_min);
  const fare_max = round100(fareData.fare_max);

  // Per person calculation (Assuming it's shared with others, at least 2 people total)
  // Spec says "2인 기준 1인 약 X,X00원"
  const divisor = Math.max(party_size, 2); // MVP assumes at least 2 people for share
  const per_person_min = round100(fare_min / divisor);
  const per_person_max = round100(fare_max / divisor);

  return {
    fare_min,
    fare_max,
    per_person_min,
    per_person_max,
    ride_minutes: fareData.ride_minutes,
    eta: fareData.ride_minutes + 5, // Just an estimate
  };
}
