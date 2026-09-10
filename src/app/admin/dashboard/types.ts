export type AdminPickup = {
  readonly id: string;
  readonly name: string;
  readonly location_desc: string;
  readonly active: boolean;
};

export type AdminDropZone = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly zone_group: "mid" | "upper";
  readonly walk_minutes: number;
  readonly display_order: number;
  readonly status: "draft" | "active" | "inactive";
};

export type AdminFare = {
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly fare_min: number;
  readonly fare_max: number;
  readonly ride_minutes: number;
};

export type AdminQueueEntry = {
  readonly id: string;
  readonly nickname: string;
  readonly party_size: number;
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly departure_mode: string;
  readonly status: string;
  readonly created_at: string;
};

export type AdminMatch = {
  readonly id: string;
  readonly team_number: number;
  readonly pickup_spot_id: string;
  readonly drop_zone_id: string;
  readonly total_party_size: number;
  readonly status: string;
  readonly created_at: string;
  readonly members: readonly AdminQueueEntry[];
};

export type AdminReport = {
  readonly id: string;
  readonly type: string;
  readonly description: string | null;
  readonly created_at: string;
};

export type AdminDashboardData = {
  readonly queue: readonly AdminQueueEntry[];
  readonly matches: readonly AdminMatch[];
  readonly reports: readonly AdminReport[];
  readonly fares: readonly AdminFare[];
  readonly pickup_spots: readonly AdminPickup[];
  readonly drop_zones: readonly AdminDropZone[];
  readonly stats: {
    readonly matches: number;
    readonly matches_today: number;
    readonly users: number;
    readonly noshows: number;
    readonly current_waiting_people: number;
    readonly oldest_waiting_at: string | null;
  };
};

export type FareDraft = {
  readonly pickupSpotId: string;
  readonly fareMin: string;
  readonly fareMax: string;
  readonly rideMinutes: string;
};

export type DestinationDraft = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly zoneGroup: "mid" | "upper";
  readonly walkMinutes: string;
  readonly status: "draft" | "active" | "inactive";
  readonly fares: readonly FareDraft[];
};
