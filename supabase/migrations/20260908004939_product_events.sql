CREATE TABLE IF NOT EXISTS public.product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID UNIQUE,
  event_name TEXT NOT NULL CHECK (
    event_name IN (
      'join_started',
      'drop_zone_selected',
      'matching_started',
      'offer_presented',
      'offer_accepted',
      'offer_declined',
      'team_assembled',
      'arrival_marked',
      'departed',
      'result_viewed',
      'account_copied',
      'settlement_created'
    )
  ),
  event_source TEXT NOT NULL DEFAULT 'client' CHECK (event_source IN ('client', 'server')),
  session_hash TEXT NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Product events from browsers are signals of intent or a rendered view only.
  -- Lifecycle reporting must be calculated from the authoritative match tables.
  CHECK (
    (event_source = 'client' AND event_name IN (
      'join_started', 'drop_zone_selected', 'matching_started', 'offer_presented',
      'offer_accepted', 'offer_declined', 'team_assembled', 'arrival_marked',
      'departed', 'result_viewed', 'account_copied'
    ))
    OR (event_source = 'server' AND event_name IN ('settlement_created'))
  ),
  CHECK (event_source <> 'client' OR event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS product_events_occurred_at_idx
  ON public.product_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS product_events_name_occurred_at_idx
  ON public.product_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS product_events_source_name_occurred_at_idx
  ON public.product_events (event_source, event_name, occurred_at DESC);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.product_events TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_product_events(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF retention_days < 1 OR retention_days > 365 THEN
    RAISE EXCEPTION 'retention_days must be between 1 and 365';
  END IF;

  DELETE FROM public.product_events
  WHERE occurred_at < clock_timestamp() - make_interval(days => retention_days);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.product_event_metrics(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'funnel', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'event_name', event_name,
            'events', event_count,
            'unique_sessions', unique_session_count
          ) ORDER BY event_name
        )
        FROM (
          SELECT event_name,
                 count(*)::integer AS event_count,
                 count(DISTINCT session_hash)::integer AS unique_session_count
          FROM public.product_events
          WHERE occurred_at >= p_start AND occurred_at < p_end
            AND event_source = 'client'
          GROUP BY event_name
        ) AS funnel_rows
      ),
      '[]'::jsonb
    ),
    'matching', jsonb_build_object(
      'total_matches', (
        SELECT count(*)::integer
        FROM public.matches
        WHERE created_at >= p_start AND created_at < p_end
      ),
      'total_people', (
        SELECT COALESCE(sum(offered_party_size), 0)::integer
        FROM public.matches
        WHERE created_at >= p_start AND created_at < p_end
      ),
      'status_counts', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('status', status, 'matches', match_count)
            ORDER BY status
          )
          FROM (
            SELECT status, count(*)::integer AS match_count
            FROM public.matches
            WHERE created_at >= p_start AND created_at < p_end
            GROUP BY status
          ) AS status_rows
        ),
        '[]'::jsonb
      ),
      'health', jsonb_build_object(
        'departed_matches', (
          SELECT count(*)::integer
          FROM public.matches
          WHERE created_at >= p_start AND created_at < p_end
            AND status = 'departed'
        ),
        -- Only resolved teams are in the denominator. Active offers/assemblies
        -- are intentionally excluded so the rate is not depressed by teams that
        -- have not had a chance to depart yet.
        'resolved_matches', (
          SELECT count(*)::integer
          FROM public.matches
          WHERE created_at >= p_start AND created_at < p_end
            AND status IN ('departed', 'cancelled')
        ),
        'offered_entries', (
          SELECT COALESCE(sum(offered_entry_count), 0)::integer
          FROM public.matches
          WHERE created_at >= p_start AND created_at < p_end
        ),
        'accepted_offer_entries', (
          SELECT COALESCE(sum(accepted_entry_count), 0)::integer
          FROM public.matches
          WHERE created_at >= p_start AND created_at < p_end
        ),
        'median_match_wait_seconds', (
          SELECT percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (m.created_at - first_entry.created_at))
          )::integer
          FROM public.matches m
          JOIN LATERAL (
            SELECT min(qe.created_at) AS created_at
            FROM public.queue_entries qe
            WHERE qe.match_id = m.id
          ) AS first_entry ON first_entry.created_at IS NOT NULL
          WHERE m.created_at >= p_start AND m.created_at < p_end
        )
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.cleanup_product_events(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_event_metrics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_product_events(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_event_metrics(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
