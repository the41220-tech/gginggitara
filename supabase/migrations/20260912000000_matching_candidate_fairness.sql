-- Keep matching complete beyond the first 20 rows while bounding the
-- combinatorial search to the earliest interchangeable entries.
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
    ORDER BY pickup_spot_id, drop_zone_id
  LOOP
    LOOP
      WITH RECURSIVE signature_ranked AS MATERIALIZED (
        SELECT qe.id,
               qe.party_size,
               qe.departure_mode,
               qe.priority_at,
               qe.queue_deadline_at,
               row_number() OVER (
                 PARTITION BY qe.party_size, qe.departure_mode,
                              (qe.queue_deadline_at <= clock_timestamp())
                 ORDER BY qe.priority_at, qe.id
               ) AS signature_rank
        FROM public.queue_entries qe
        WHERE qe.status = 'waiting'
          AND qe.pickup_spot_id = v_pool.pickup_spot_id
          AND qe.drop_zone_id = v_pool.drop_zone_id
      ), locked_pool AS MATERIALIZED (
        SELECT sr.id,
               sr.party_size,
               sr.departure_mode,
               sr.priority_at,
               sr.queue_deadline_at
        FROM signature_ranked sr
        JOIN public.queue_entries qe ON qe.id = sr.id
        WHERE sr.signature_rank <= 4
          AND qe.status = 'waiting'
        ORDER BY sr.priority_at, sr.id
        FOR UPDATE OF qe SKIP LOCKED
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
      ORDER BY c.oldest_priority,
               (c.total_people = 4) DESC,
               c.total_people DESC,
               c.entry_count ASC
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

-- A stale or versionless tab must never cancel a newer offer.
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
    IF p_offer_version IS DISTINCT FROM v_entry.offer_version THEN
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

REVOKE ALL ON FUNCTION public.run_matching_engine() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_queue_entry(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_matching_engine() TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry(UUID, TEXT, TEXT, INTEGER) TO service_role;
