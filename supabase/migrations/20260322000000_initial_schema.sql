-- Enable UUID generation (pgcrypto is allowlisted on Supabase Cloud;
-- gen_random_uuid() resolves on both local and cloud without search_path tweaks)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. pickup_spots
CREATE TABLE pickup_spots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location_desc TEXT NOT NULL,
    color TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. drop_zones
CREATE TABLE drop_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    zone_group TEXT NOT NULL, -- 'mid' / 'upper'
    walk_minutes INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. fare_table
CREATE TABLE fare_table (
    pickup_spot_id TEXT REFERENCES pickup_spots(id),
    drop_zone_id TEXT REFERENCES drop_zones(id),
    fare_min INTEGER NOT NULL,
    fare_max INTEGER NOT NULL,
    ride_minutes INTEGER NOT NULL,
    PRIMARY KEY (pickup_spot_id, drop_zone_id)
);

-- 4. matches
CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_number INTEGER NOT NULL,
    pickup_spot_id TEXT REFERENCES pickup_spots(id),
    drop_zone_id TEXT REFERENCES drop_zones(id),
    total_party_size INTEGER NOT NULL,
    eta_minutes INTEGER,
    est_fare_min INTEGER,
    est_fare_max INTEGER,
    assembly_deadline TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'assembling', -- 'assembling', 'all_arrived', 'departed', 'cancelled'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. queue_entries
CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    party_size INTEGER NOT NULL CHECK (party_size >= 1 AND party_size <= 3),
    pickup_spot_id TEXT REFERENCES pickup_spots(id),
    drop_zone_id TEXT REFERENCES drop_zones(id),
    status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting', 'matching', 'matched', 'arrived', 'expired', 'cancelled', 'departed', 'noshow'
    match_id UUID REFERENCES matches(id),
    noshow_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. reports
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_session_id TEXT NOT NULL,
    match_id UUID REFERENCES matches(id),
    type TEXT NOT NULL, -- 'noshow', 'wrong_count', 'bad_behavior', 'other'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. blocked_sessions
CREATE TABLE blocked_sessions (
    session_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (RLS) Configuration
ALTER TABLE pickup_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE drop_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_sessions ENABLE ROW LEVEL SECURITY;

-- Public read access for setup tables
CREATE POLICY "Public read access for pickup_spots" ON pickup_spots FOR SELECT USING (true);
CREATE POLICY "Public read access for drop_zones" ON drop_zones FOR SELECT USING (true);
CREATE POLICY "Public read access for fare_table" ON fare_table FOR SELECT USING (true);

-- Queue entries: Users can see their own entries and create new ones
CREATE POLICY "Users can insert queue_entries" ON queue_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read access for queue_entries" ON queue_entries FOR SELECT USING (true); -- Shared for matching visibility
CREATE POLICY "Users can update queue_entries" ON queue_entries FOR UPDATE USING (true);

-- Matches: Public read
CREATE POLICY "Public read access for matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Users can update matches status" ON matches FOR UPDATE USING (true);

-- Reports: Insert only
CREATE POLICY "Users can insert reports" ON reports FOR INSERT WITH CHECK (true);

-- Blocked Sessions: Service role only (No public policies needed, but keeping for reference)
-- Default is deny all, which is correct for service_role only access.

-- RPC for sequential team numbers
CREATE OR REPLACE FUNCTION get_next_team_number()
RETURNS INTEGER AS $$
DECLARE
    today_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO today_count
    FROM matches
    WHERE created_at >= CURRENT_DATE;

    RETURN today_count + 1;
END;
$$ LANGUAGE plpgsql;

-- Seed Data
INSERT INTO pickup_spots (id, name, location_desc, color) VALUES
('spot_a', 'Spot A', '부산대역 3번 출구 전담 SPOT 맞은편', '#2563EB'),
('spot_b', 'Spot B', '부산대역 1번 출구 어벤더치 맞은편', '#16A34A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO drop_zones (id, name, zone_group, walk_minutes) VALUES
('m1', '생물관', 'mid', 2),
('m2', '건설관', 'mid', 3),
('u1', '음악관', 'upper', 5),
('u2', '법학관', 'upper', 4)
ON CONFLICT (id) DO NOTHING;

-- Initial Fare Table (Realistic PNU pilot values)
INSERT INTO fare_table (pickup_spot_id, drop_zone_id, fare_min, fare_max, ride_minutes) VALUES
-- Spot A (3번 출구)
('spot_a', 'm1', 3900, 5900, 6),
('spot_a', 'm2', 4300, 6300, 7),
('spot_a', 'u1', 5300, 7300, 10),
('spot_a', 'u2', 4100, 6100, 7),
-- Spot B (1번 출구)
('spot_b', 'm1', 3900, 5900, 6),
('spot_b', 'm2', 4300, 6300, 8),
('spot_b', 'u1', 5300, 7300, 10),
('spot_b', 'u2', 4100, 6100, 7)
ON CONFLICT (pickup_spot_id, drop_zone_id) 
DO UPDATE SET 
  fare_min = EXCLUDED.fare_min,
  fare_max = EXCLUDED.fare_max,
  ride_minutes = EXCLUDED.ride_minutes;
