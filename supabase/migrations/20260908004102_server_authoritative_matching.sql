ALTER TABLE public.drop_zones
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.drop_zones
SET status = COALESCE(status, 'active');

WITH ordered_zones AS (
  SELECT id, row_number() OVER (ORDER BY zone_group, id) - 1 AS position
  FROM public.drop_zones
)
UPDATE public.drop_zones dz
SET display_order = ordered_zones.position
FROM ordered_zones
WHERE dz.id = ordered_zones.id
  AND dz.display_order = 0;

ALTER TABLE public.drop_zones
  ALTER COLUMN status SET DEFAULT 'draft',
  ALTER COLUMN status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS drop_zones_status_check;
ALTER TABLE public.drop_zones
  ADD CONSTRAINT drop_zones_status_check
  CHECK (status IN ('draft', 'active', 'inactive'));

ALTER TABLE public.drop_zones
  DROP CONSTRAINT IF EXISTS drop_zones_catalog_values_check;
ALTER TABLE public.drop_zones
  ADD CONSTRAINT drop_zones_catalog_values_check
  CHECK (
    id ~ '^[a-z0-9][a-z0-9_-]{1,47}$'
    AND char_length(name) BETWEEN 1 AND 60
    AND (description IS NULL OR char_length(description) BETWEEN 1 AND 140)
    AND zone_group IN ('mid', 'upper')
    AND walk_minutes BETWEEN 0 AND 60
    AND display_order BETWEEN 0 AND 10000
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drop_zones_touch_updated_at ON public.drop_zones;
CREATE TRIGGER drop_zones_touch_updated_at
BEFORE UPDATE ON public.drop_zones
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS departure_mode TEXT NOT NULL DEFAULT 'fast',
  ADD COLUMN IF NOT EXISTS priority_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS queue_deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '3 minutes'),
  ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS policy_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.queue_entries
  DROP CONSTRAINT IF EXISTS queue_entries_departure_mode_check;
ALTER TABLE public.queue_entries
  ADD CONSTRAINT queue_entries_departure_mode_check
  CHECK (departure_mode IN ('fast', 'cheap'));

ALTER TABLE public.queue_entries
  DROP CONSTRAINT IF EXISTS queue_entries_status_check,
  DROP CONSTRAINT IF EXISTS queue_entries_match_state_check;
ALTER TABLE public.queue_entries
  ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN (
    'waiting', 'offered', 'matched', 'arrived', 'paused',
    'expired', 'cancelled', 'departed', 'noshow'
  )) NOT VALID,
  ADD CONSTRAINT queue_entries_match_state_check
  CHECK (
    (status IN ('offered', 'matched', 'arrived', 'departed', 'noshow') AND match_id IS NOT NULL)
    OR (status IN ('waiting', 'paused', 'expired', 'cancelled') AND match_id IS NULL)
  ) NOT VALID;

UPDATE public.queue_entries
SET priority_at = created_at,
    queue_deadline_at = created_at + interval '3 minutes',
    status = CASE WHEN status = 'matching' THEN 'waiting' ELSE status END;

WITH active_entries AS (
  SELECT id,
         row_number() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS active_rank
  FROM public.queue_entries
  WHERE status IN ('waiting', 'offered', 'matched', 'arrived', 'paused')
)
UPDATE public.queue_entries qe
SET status = 'cancelled', match_id = NULL
FROM active_entries ae
WHERE qe.id = ae.id AND ae.active_rank > 1;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS service_date DATE,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS route_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS policy_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS offered_party_size INTEGER,
  ADD COLUMN IF NOT EXISTS offered_entry_count INTEGER,
  ADD COLUMN IF NOT EXISTS accepted_entry_count INTEGER;

UPDATE public.matches
SET service_date = (created_at AT TIME ZONE 'Asia/Seoul')::date,
    status = CASE WHEN status = 'all_arrived' THEN 'ready' ELSE status END
WHERE service_date IS NULL;

UPDATE public.matches match_row
SET offered_party_size = COALESCE(offered_party_size, total_party_size),
    offered_entry_count = COALESCE(
      offered_entry_count,
      GREATEST(1, (
        SELECT count(*)::INTEGER
        FROM public.queue_entries entry_row
        WHERE entry_row.match_id = match_row.id
      ))
    ),
    accepted_entry_count = COALESCE(
      accepted_entry_count,
      CASE
        WHEN status IN ('assembling', 'ready', 'departed') THEN GREATEST(1, (
          SELECT count(*)::INTEGER
          FROM public.queue_entries entry_row
          WHERE entry_row.match_id = match_row.id
        ))
        ELSE (
          SELECT count(*)::INTEGER
          FROM public.queue_entries entry_row
          WHERE entry_row.match_id = match_row.id
            AND entry_row.offer_accepted_at IS NOT NULL
        )
      END
    );

ALTER TABLE public.matches
  ALTER COLUMN service_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  ALTER COLUMN service_date SET NOT NULL,
  ALTER COLUMN offered_party_size SET DEFAULT 0,
  ALTER COLUMN offered_party_size SET NOT NULL,
  ALTER COLUMN offered_entry_count SET DEFAULT 0,
  ALTER COLUMN offered_entry_count SET NOT NULL,
  ALTER COLUMN accepted_entry_count SET DEFAULT 0,
  ALTER COLUMN accepted_entry_count SET NOT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_status_check,
  DROP CONSTRAINT IF EXISTS matches_capacity_check,
  DROP CONSTRAINT IF EXISTS matches_offer_state_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('offered', 'assembling', 'ready', 'departed', 'cancelled')) NOT VALID,
  ADD CONSTRAINT matches_capacity_check
  CHECK (
    total_party_size BETWEEN 2 AND 4
    AND offered_party_size BETWEEN 2 AND 4
    AND offered_entry_count BETWEEN 2 AND 4
    AND accepted_entry_count BETWEEN 0 AND offered_entry_count
  ) NOT VALID,
  ADD CONSTRAINT matches_offer_state_check
  CHECK (status <> 'offered' OR offer_expires_at IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS matches_daily_team_number_key
  ON matches (service_date, team_number);

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_one_active_session_key
  ON queue_entries (session_id)
  WHERE status IN ('waiting', 'offered', 'matched', 'arrived', 'paused');

ALTER TABLE public.fare_table
  DROP CONSTRAINT IF EXISTS fare_table_values_check;
ALTER TABLE public.fare_table
  ADD CONSTRAINT fare_table_values_check
  CHECK (
    fare_min BETWEEN 1 AND 100000
    AND fare_max BETWEEN fare_min AND 100000
    AND ride_minutes BETWEEN 1 AND 180
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS queue_entries_pool_priority_idx
  ON queue_entries (pickup_spot_id, drop_zone_id, priority_at, id)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS matches_offer_deadline_idx
  ON public.matches (offer_expires_at)
  WHERE status = 'offered';

CREATE INDEX IF NOT EXISTS matches_assembly_deadline_idx
  ON public.matches (assembly_deadline)
  WHERE status = 'assembling';

CREATE TABLE IF NOT EXISTS match_daily_counters (
  service_date DATE PRIMARY KEY,
  last_number INTEGER NOT NULL CHECK (last_number > 0)
);

INSERT INTO public.match_daily_counters(service_date, last_number)
SELECT service_date, max(team_number)
FROM public.matches
GROUP BY service_date
ON CONFLICT (service_date) DO UPDATE
SET last_number = GREATEST(public.match_daily_counters.last_number, EXCLUDED.last_number);

CREATE TABLE IF NOT EXISTS noshow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  match_id UUID NOT NULL REFERENCES matches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (queue_entry_id, match_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  payer_session_id TEXT NOT NULL,
  payer_nickname TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder_masked TEXT NOT NULL,
  actual_total_fare INTEGER CHECK (actual_total_fare BETWEEN 1000 AND 200000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS actual_total_fare INTEGER;
ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS settlements_actual_total_fare_check;
ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_actual_total_fare_check
  CHECK (actual_total_fare IS NULL OR actual_total_fare BETWEEN 1000 AND 200000);

ALTER TABLE match_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE noshow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON match_daily_counters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON noshow_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON settlements TO service_role;

CREATE POLICY "deny_all_match_daily_counters"
  ON match_daily_counters FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_noshow_events"
  ON noshow_events FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "deny_all_settlements"
  ON settlements FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION next_team_number_kst()
RETURNS TABLE(out_service_date DATE, out_team_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_service_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_team_number INTEGER;
BEGIN
  INSERT INTO public.match_daily_counters(service_date, last_number)
  VALUES (v_service_date, 1)
  ON CONFLICT (service_date) DO UPDATE
    SET last_number = public.match_daily_counters.last_number + 1
  RETURNING last_number INTO v_team_number;

  RETURN QUERY SELECT v_service_date, v_team_number;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_matching_timeouts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match RECORD;
  v_arrived_entries INTEGER;
  v_arrived_people INTEGER;
  v_offer_timeouts INTEGER := 0;
  v_assembly_timeouts INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(7777777);

  FOR v_match IN
    SELECT id
    FROM public.matches
    WHERE status = 'offered'
      AND offer_expires_at <= clock_timestamp()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.matches match_row
    SET status = 'cancelled',
        accepted_entry_count = (
          SELECT count(*)::INTEGER
          FROM public.queue_entries entry_row
          WHERE entry_row.match_id = v_match.id
            AND entry_row.offer_accepted_at IS NOT NULL
        )
    WHERE match_row.id = v_match.id;

    UPDATE public.queue_entries
    SET status = CASE WHEN offer_accepted_at IS NULL THEN 'paused' ELSE 'waiting' END,
        match_id = NULL,
        offered_at = NULL,
        offer_accepted_at = NULL,
        queue_deadline_at = CASE
          WHEN offer_accepted_at IS NULL THEN queue_deadline_at
          ELSE clock_timestamp() + interval '3 minutes'
        END
    WHERE match_id = v_match.id
      AND status = 'offered';
    v_offer_timeouts := v_offer_timeouts + 1;
  END LOOP;

  FOR v_match IN
    SELECT id
    FROM public.matches
    WHERE status = 'assembling'
      AND assembly_deadline <= clock_timestamp()
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.noshow_events(session_id, queue_entry_id, match_id)
    SELECT session_id, id, v_match.id
    FROM public.queue_entries
    WHERE match_id = v_match.id
      AND status = 'matched'
    ON CONFLICT (queue_entry_id, match_id) DO NOTHING;

    UPDATE public.queue_entries
    SET status = 'noshow', noshow_count = COALESCE(noshow_count, 0) + 1
    WHERE match_id = v_match.id
      AND status = 'matched';

    INSERT INTO public.blocked_sessions(session_id, reason, blocked_until)
    SELECT event_counts.session_id,
           '3 no-shows in rolling 24 hours',
           clock_timestamp() + interval '30 minutes'
    FROM (
      SELECT ne.session_id
      FROM public.noshow_events ne
      WHERE ne.created_at > clock_timestamp() - interval '24 hours'
        AND ne.session_id IN (
          SELECT qe.session_id
          FROM public.queue_entries qe
          WHERE qe.match_id = v_match.id AND qe.status = 'noshow'
        )
      GROUP BY ne.session_id
      HAVING count(*) >= 3
    ) AS event_counts
    ON CONFLICT (session_id) DO UPDATE
      SET reason = EXCLUDED.reason,
          blocked_until = GREATEST(public.blocked_sessions.blocked_until, EXCLUDED.blocked_until);

    SELECT count(*), COALESCE(sum(party_size), 0)
    INTO v_arrived_entries, v_arrived_people
    FROM public.queue_entries
    WHERE match_id = v_match.id
      AND status = 'arrived';

    IF v_arrived_entries >= 2 THEN
      UPDATE public.matches
      SET status = 'ready', total_party_size = v_arrived_people
      WHERE id = v_match.id;
    ELSE
      UPDATE public.queue_entries
      SET status = 'waiting',
          match_id = NULL,
          offered_at = NULL,
          offer_accepted_at = NULL,
          queue_deadline_at = clock_timestamp() + interval '3 minutes'
      WHERE match_id = v_match.id
        AND status = 'arrived';
      UPDATE public.matches SET status = 'cancelled' WHERE id = v_match.id;
    END IF;

    v_assembly_timeouts := v_assembly_timeouts + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'offer_timeouts', v_offer_timeouts,
    'assembly_timeouts', v_assembly_timeouts
  );
END;
$$;

CREATE OR REPLACE FUNCTION run_matching_engine()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pool RECORD;
  v_candidate_ids UUID[];
  v_total_people INTEGER;
  v_team RECORD;
  v_match_id UUID;
  v_updated INTEGER;
  v_created INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(7777777);
  PERFORM public.resolve_matching_timeouts();

  FOR v_pool IN
    SELECT DISTINCT pickup_spot_id, drop_zone_id
    FROM public.queue_entries
    WHERE status = 'waiting'
  LOOP
    LOOP
      WITH RECURSIVE locked_pool AS MATERIALIZED (
        SELECT qe.id, qe.party_size, qe.departure_mode, qe.priority_at,
               qe.queue_deadline_at
        FROM public.queue_entries qe
        WHERE qe.status = 'waiting'
          AND qe.pickup_spot_id = v_pool.pickup_spot_id
          AND qe.drop_zone_id = v_pool.drop_zone_id
        ORDER BY qe.priority_at, qe.id
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      ), ranked AS MATERIALIZED (
        SELECT lp.*, row_number() OVER (ORDER BY lp.priority_at, lp.id) AS rn
        FROM locked_pool lp
      ), combinations AS (
        SELECT ARRAY[r.id] AS ids,
               r.rn AS last_rn,
               r.party_size AS total_people,
               1 AS entry_count,
               (r.departure_mode = 'fast') AS all_fast,
               r.priority_at AS oldest_priority,
               r.queue_deadline_at AS oldest_deadline
        FROM ranked r
        UNION ALL
        SELECT c.ids || r.id,
               r.rn,
               c.total_people + r.party_size,
               c.entry_count + 1,
               c.all_fast AND r.departure_mode = 'fast',
               c.oldest_priority,
               LEAST(c.oldest_deadline, r.queue_deadline_at)
        FROM combinations c
        JOIN ranked r ON r.rn > c.last_rn
        WHERE c.entry_count < 4
          AND c.total_people + r.party_size <= 4
      )
      SELECT c.ids, c.total_people
      INTO v_candidate_ids, v_total_people
      FROM combinations c
      WHERE c.entry_count >= 2
        AND (
          c.total_people = 4
          OR (
            c.total_people BETWEEN 2 AND 3
            AND (c.all_fast OR c.oldest_deadline <= clock_timestamp())
          )
        )
      ORDER BY c.oldest_priority, (c.total_people = 4) DESC,
               c.total_people DESC, c.entry_count ASC
      LIMIT 1;

      EXIT WHEN v_candidate_ids IS NULL;

      SELECT * INTO v_team FROM public.next_team_number_kst();

      INSERT INTO public.matches(
        team_number, service_date, pickup_spot_id, drop_zone_id,
        total_party_size, offered_party_size, offered_entry_count,
        accepted_entry_count, eta_minutes, est_fare_min, est_fare_max,
        assembly_deadline, status, offer_expires_at, offer_version,
        route_snapshot, policy_version
      )
      SELECT v_team.out_team_number,
             v_team.out_service_date,
             v_pool.pickup_spot_id,
             v_pool.drop_zone_id,
             v_total_people,
             v_total_people,
             cardinality(v_candidate_ids),
             0,
             ft.ride_minutes,
             ft.fare_min,
             ft.fare_max,
             clock_timestamp() + interval '3 minutes',
             'offered',
             clock_timestamp() + interval '20 seconds',
             1,
             jsonb_build_object(
               'pickup_spot_id', ps.id,
               'pickup_name', ps.name,
               'pickup_location_desc', ps.location_desc,
               'drop_zone_id', dz.id,
               'drop_zone_name', dz.name,
               'walk_minutes', dz.walk_minutes,
               'fare_min', ft.fare_min,
               'fare_max', ft.fare_max,
               'ride_minutes', ft.ride_minutes
             ),
             1
      FROM public.pickup_spots ps
      JOIN public.drop_zones dz ON dz.id = v_pool.drop_zone_id
      JOIN public.fare_table ft
        ON ft.pickup_spot_id = v_pool.pickup_spot_id
       AND ft.drop_zone_id = v_pool.drop_zone_id
      WHERE ps.id = v_pool.pickup_spot_id
      RETURNING id INTO v_match_id;

      IF v_match_id IS NULL THEN
        RAISE EXCEPTION 'active route has no fare snapshot';
      END IF;

      UPDATE public.queue_entries
      SET status = 'offered',
          match_id = v_match_id,
          offered_at = clock_timestamp(),
          offer_accepted_at = NULL,
          offer_version = offer_version + 1
      WHERE id = ANY(v_candidate_ids)
        AND status = 'waiting';
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated <> cardinality(v_candidate_ids) THEN
        RAISE EXCEPTION 'atomic offer membership changed';
      END IF;

      v_created := v_created + 1;
      v_candidate_ids := NULL;
    END LOOP;
  END LOOP;

  UPDATE public.queue_entries
  SET status = 'expired'
  WHERE status = 'waiting'
    AND queue_deadline_at <= clock_timestamp();

  RETURN jsonb_build_object('offers_created', v_created, 'server_now', clock_timestamp());
END;
$$;

CREATE OR REPLACE FUNCTION transition_queue_entry(
  p_entry_id UUID,
  p_session_id TEXT,
  p_action TEXT,
  p_offer_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_remaining INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(7777777);
  PERFORM public.resolve_matching_timeouts();

  SELECT * INTO v_entry
  FROM public.queue_entries
  WHERE id = p_entry_id AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue entry not found or not owned' USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'resume' THEN
    IF v_entry.status <> 'paused' THEN
      RAISE EXCEPTION 'entry is not paused' USING ERRCODE = '22023';
    END IF;
    UPDATE public.queue_entries
    SET status = 'waiting', queue_deadline_at = clock_timestamp() + interval '3 minutes'
    WHERE id = p_entry_id;
    RETURN jsonb_build_object('status', 'waiting');
  END IF;

  IF p_action = 'cancel' AND v_entry.status IN ('waiting', 'paused') THEN
    UPDATE public.queue_entries SET status = 'cancelled' WHERE id = p_entry_id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_entry.match_id IS NULL THEN
    RAISE EXCEPTION 'entry has no active offer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = v_entry.match_id FOR UPDATE;

  IF p_action = 'accept' THEN
    IF v_entry.status = 'matched' OR v_entry.status = 'arrived' THEN
      RETURN jsonb_build_object('status', v_entry.status, 'match_id', v_entry.match_id);
    END IF;
    IF v_entry.status <> 'offered' OR v_match.status <> 'offered'
       OR p_offer_version IS DISTINCT FROM v_entry.offer_version
       OR v_match.offer_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'offer is stale or expired' USING ERRCODE = '40001';
    END IF;

    UPDATE public.queue_entries
    SET offer_accepted_at = clock_timestamp()
    WHERE id = p_entry_id AND offer_accepted_at IS NULL;

    UPDATE public.matches match_row
    SET accepted_entry_count = (
      SELECT count(*)::INTEGER
      FROM public.queue_entries entry_row
      WHERE entry_row.match_id = v_entry.match_id
        AND entry_row.offer_accepted_at IS NOT NULL
    )
    WHERE match_row.id = v_entry.match_id;

    SELECT count(*) INTO v_remaining
    FROM public.queue_entries
    WHERE match_id = v_entry.match_id
      AND status = 'offered'
      AND offer_accepted_at IS NULL;

    IF v_remaining = 0 THEN
      UPDATE public.matches
      SET status = 'assembling', assembly_deadline = clock_timestamp() + interval '3 minutes'
      WHERE id = v_entry.match_id AND status = 'offered';
      UPDATE public.queue_entries SET status = 'matched' WHERE match_id = v_entry.match_id AND status = 'offered';
      RETURN jsonb_build_object('status', 'matched', 'match_id', v_entry.match_id, 'all_accepted', true);
    END IF;

    RETURN jsonb_build_object('status', 'offered', 'match_id', v_entry.match_id, 'all_accepted', false);
  END IF;

  IF p_action IN ('decline', 'cancel') AND v_entry.status = 'offered' AND v_match.status = 'offered' THEN
    IF p_offer_version IS NOT NULL AND p_offer_version IS DISTINCT FROM v_entry.offer_version THEN
      RAISE EXCEPTION 'offer version mismatch' USING ERRCODE = '40001';
    END IF;
    UPDATE public.matches match_row
    SET status = 'cancelled',
        accepted_entry_count = (
          SELECT count(*)::INTEGER
          FROM public.queue_entries entry_row
          WHERE entry_row.match_id = v_entry.match_id
            AND entry_row.offer_accepted_at IS NOT NULL
        )
    WHERE match_row.id = v_entry.match_id;
    UPDATE public.queue_entries
    SET status = CASE WHEN id = p_entry_id THEN 'cancelled' ELSE 'waiting' END,
        match_id = NULL,
        offered_at = NULL,
        offer_accepted_at = NULL,
        queue_deadline_at = CASE
          WHEN id = p_entry_id THEN queue_deadline_at
          ELSE clock_timestamp() + interval '3 minutes'
        END
    WHERE match_id = v_entry.match_id AND status = 'offered';
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  RAISE EXCEPTION 'invalid queue transition' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION transition_match(
  p_match_id UUID,
  p_session_id TEXT,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_waiting INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(7777777);
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  SELECT * INTO v_entry
  FROM public.queue_entries
  WHERE match_id = p_match_id AND session_id = p_session_id
  FOR UPDATE;

  IF v_match.id IS NULL OR v_entry.id IS NULL THEN
    RAISE EXCEPTION 'match membership not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_action IN ('arrive', 'depart')
     AND v_match.status = 'assembling'
     AND v_match.assembly_deadline <= clock_timestamp() THEN
    RAISE EXCEPTION 'assembly deadline has elapsed' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'arrive' THEN
    IF v_match.status NOT IN ('assembling', 'ready') OR v_entry.status NOT IN ('matched', 'arrived') THEN
      RAISE EXCEPTION 'cannot arrive in current state' USING ERRCODE = '22023';
    END IF;
    UPDATE public.queue_entries SET status = 'arrived' WHERE id = v_entry.id;
    SELECT count(*) INTO v_waiting
    FROM public.queue_entries WHERE match_id = p_match_id AND status = 'matched';
    IF v_waiting = 0 THEN
      UPDATE public.matches SET status = 'ready' WHERE id = p_match_id AND status = 'assembling';
    END IF;
    RETURN jsonb_build_object('success', true, 'allArrived', v_waiting = 0);
  END IF;

  IF p_action = 'depart' THEN
    IF v_match.status = 'departed' THEN
      RETURN jsonb_build_object('success', true, 'status', 'departed');
    END IF;
    IF v_match.status <> 'ready' OR v_entry.status <> 'arrived' THEN
      RAISE EXCEPTION 'match is not ready to depart' USING ERRCODE = '22023';
    END IF;
    UPDATE public.matches SET status = 'departed' WHERE id = p_match_id;
    UPDATE public.queue_entries SET status = 'departed' WHERE match_id = p_match_id AND status = 'arrived';
    RETURN jsonb_build_object('success', true, 'status', 'departed');
  END IF;

  RAISE EXCEPTION 'invalid match transition' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION admin_save_drop_zone(
  p_id TEXT,
  p_create BOOLEAN,
  p_patch JSONB,
  p_fares JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_zone public.drop_zones%ROWTYPE;
  v_status TEXT;
  v_fare_count INTEGER;
  v_unique_fare_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(7777778);

  IF p_id IS NULL
     OR p_id !~ '^[a-z0-9][a-z0-9_-]{1,47}$'
     OR p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object'
     OR (p_fares IS NOT NULL AND jsonb_typeof(p_fares) <> 'array')
     OR (p_fares IS NOT NULL AND jsonb_array_length(p_fares) > 100) THEN
    RAISE EXCEPTION 'invalid drop zone payload' USING ERRCODE = '22023';
  END IF;

  IF p_fares IS NOT NULL THEN
    SELECT count(*), count(DISTINCT pickup_spot_id)
    INTO v_fare_count, v_unique_fare_count
    FROM jsonb_to_recordset(p_fares)
      AS fare(pickup_spot_id TEXT, fare_min INTEGER, fare_max INTEGER, ride_minutes INTEGER);

    IF v_fare_count <> v_unique_fare_count THEN
      RAISE EXCEPTION 'duplicate pickup fare' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_create THEN
    IF NOT (
      p_patch ? 'name'
      AND p_patch ? 'zone_group'
      AND p_patch ? 'walk_minutes'
      AND p_patch ? 'display_order'
      AND p_patch ? 'status'
    ) THEN
      RAISE EXCEPTION 'missing drop zone fields' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.drop_zones(
      id, name, description, zone_group, walk_minutes, display_order, status
    ) VALUES (
      p_id,
      p_patch->>'name',
      p_patch->>'description',
      p_patch->>'zone_group',
      (p_patch->>'walk_minutes')::INTEGER,
      (p_patch->>'display_order')::INTEGER,
      p_patch->>'status'
    )
    RETURNING * INTO v_zone;
  ELSE
    SELECT * INTO v_zone
    FROM public.drop_zones
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'drop zone not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.drop_zones
    SET name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
        description = CASE
          WHEN p_patch ? 'description' THEN p_patch->>'description'
          ELSE description
        END,
        zone_group = CASE
          WHEN p_patch ? 'zone_group' THEN p_patch->>'zone_group'
          ELSE zone_group
        END,
        walk_minutes = CASE
          WHEN p_patch ? 'walk_minutes' THEN (p_patch->>'walk_minutes')::INTEGER
          ELSE walk_minutes
        END,
        display_order = CASE
          WHEN p_patch ? 'display_order' THEN (p_patch->>'display_order')::INTEGER
          ELSE display_order
        END,
        status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE status END
    WHERE id = p_id
    RETURNING * INTO v_zone;
  END IF;

  IF p_fares IS NOT NULL THEN
    INSERT INTO public.fare_table(
      pickup_spot_id, drop_zone_id, fare_min, fare_max, ride_minutes
    )
    SELECT fare.pickup_spot_id, p_id, fare.fare_min, fare.fare_max, fare.ride_minutes
    FROM jsonb_to_recordset(p_fares)
      AS fare(pickup_spot_id TEXT, fare_min INTEGER, fare_max INTEGER, ride_minutes INTEGER)
    ON CONFLICT (pickup_spot_id, drop_zone_id) DO UPDATE
    SET fare_min = EXCLUDED.fare_min,
        fare_max = EXCLUDED.fare_max,
        ride_minutes = EXCLUDED.ride_minutes;
  END IF;

  SELECT status INTO v_status FROM public.drop_zones WHERE id = p_id;
  IF v_status = 'active' AND EXISTS (
    SELECT 1
    FROM public.pickup_spots ps
    LEFT JOIN public.fare_table ft
      ON ft.pickup_spot_id = ps.id
     AND ft.drop_zone_id = p_id
    WHERE ps.active = true
      AND (
        ft.pickup_spot_id IS NULL
        OR ft.fare_min < 1
        OR ft.fare_max < ft.fare_min
        OR ft.ride_minutes < 1
      )
  ) THEN
    RAISE EXCEPTION 'active drop zone requires complete fares' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zone FROM public.drop_zones WHERE id = p_id;
  RETURN jsonb_build_object('drop_zone', to_jsonb(v_zone));
END;
$$;

CREATE OR REPLACE FUNCTION admin_reorder_drop_zones(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requested INTEGER;
  v_found INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(7777778);

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'invalid reorder payload' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT id)
  INTO v_requested, v_found
  FROM jsonb_to_recordset(p_items) AS item(id TEXT, display_order INTEGER);

  IF v_requested <> v_found OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(id TEXT, display_order INTEGER)
    WHERE item.id !~ '^[a-z0-9][a-z0-9_-]{1,47}$'
       OR item.display_order NOT BETWEEN 0 AND 10000
  ) OR (
    SELECT count(DISTINCT display_order)
    FROM jsonb_to_recordset(p_items) AS item(id TEXT, display_order INTEGER)
  ) <> v_requested THEN
    RAISE EXCEPTION 'invalid reorder items' USING ERRCODE = '22023';
  END IF;

  PERFORM dz.id
  FROM public.drop_zones dz
  JOIN jsonb_to_recordset(p_items) AS item(id TEXT, display_order INTEGER)
    ON item.id = dz.id
  ORDER BY dz.id
  FOR UPDATE OF dz;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found <> v_requested THEN
    RAISE EXCEPTION 'drop zone not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.drop_zones dz
  SET display_order = item.display_order
  FROM jsonb_to_recordset(p_items) AS item(id TEXT, display_order INTEGER)
  WHERE dz.id = item.id;

  RETURN jsonb_build_object('reordered', p_items);
END;
$$;

REVOKE ALL ON FUNCTION public.next_team_number_kst() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_matching_timeouts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_matching_engine() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_queue_entry(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_match(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_drop_zone(TEXT, BOOLEAN, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reorder_drop_zones(JSONB) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Public read access for queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Server read queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "allow_select_queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Users can insert queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Server insert queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "deny_insert_queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Users can update queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Server update queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "deny_update_queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "deny_delete_queue_entries" ON public.queue_entries;

DROP POLICY IF EXISTS "Public read access for matches" ON public.matches;
DROP POLICY IF EXISTS "Server read matches" ON public.matches;
DROP POLICY IF EXISTS "allow_select_matches" ON public.matches;
DROP POLICY IF EXISTS "Server insert matches" ON public.matches;
DROP POLICY IF EXISTS "deny_insert_matches" ON public.matches;
DROP POLICY IF EXISTS "Users can update matches status" ON public.matches;
DROP POLICY IF EXISTS "Server update matches" ON public.matches;
DROP POLICY IF EXISTS "deny_update_matches" ON public.matches;

DROP POLICY IF EXISTS "Users can insert reports" ON public.reports;
DROP POLICY IF EXISTS "Server insert reports" ON public.reports;
DROP POLICY IF EXISTS "Server read reports" ON public.reports;
DROP POLICY IF EXISTS "deny_select_reports" ON public.reports;
DROP POLICY IF EXISTS "deny_insert_reports" ON public.reports;

DROP POLICY IF EXISTS "Server manage blocked_sessions" ON public.blocked_sessions;
DROP POLICY IF EXISTS "deny_all_blocked_sessions" ON public.blocked_sessions;

DROP POLICY IF EXISTS "Public read access for pickup_spots" ON public.pickup_spots;
DROP POLICY IF EXISTS "Public read access for drop_zones" ON public.drop_zones;
DROP POLICY IF EXISTS "Public read access for fare_table" ON public.fare_table;
DROP POLICY IF EXISTS "Public read fare_table" ON public.fare_table;
DROP POLICY IF EXISTS "Server update fare_table" ON public.fare_table;

REVOKE ALL ON TABLE public.queue_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.blocked_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.match_daily_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.noshow_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pickup_spots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.drop_zones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fare_table FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.queue_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.matches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.blocked_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pickup_spots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drop_zones TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fare_table TO service_role;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.next_team_number_kst() TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_matching_timeouts() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_matching_engine() TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry(UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_match(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_drop_zone(TEXT, BOOLEAN, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reorder_drop_zones(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.get_next_team_number() FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.get_next_team_number();

DROP FUNCTION IF EXISTS public.atomic_match_entries(UUID[], UUID);
DROP FUNCTION IF EXISTS public.try_acquire_matching_lock();
DROP FUNCTION IF EXISTS public.release_matching_lock();
DROP FUNCTION IF EXISTS public.expire_inactive_entries(INTEGER);
