-- Close leftover Data API read paths.
-- 20260908004102 already revokes anon/authenticated and drops USING(true)
-- select policies. This migration is idempotent: it re-revokes and adds
-- explicit deny-all RLS so a restored GRANT cannot dump queue/match/report rows.

DROP POLICY IF EXISTS "allow_select_queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "allow_select_matches" ON public.matches;
DROP POLICY IF EXISTS "Public read access for queue_entries" ON public.queue_entries;
DROP POLICY IF EXISTS "Public read access for matches" ON public.matches;

DROP POLICY IF EXISTS "deny_all_queue_entries" ON public.queue_entries;
CREATE POLICY "deny_all_queue_entries"
  ON public.queue_entries FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_all_matches" ON public.matches;
CREATE POLICY "deny_all_matches"
  ON public.matches FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_all_reports" ON public.reports;
CREATE POLICY "deny_all_reports"
  ON public.reports FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_all_blocked_sessions" ON public.blocked_sessions;
CREATE POLICY "deny_all_blocked_sessions"
  ON public.blocked_sessions FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.queue_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.blocked_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.noshow_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.queue_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.matches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.blocked_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settlements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.noshow_events TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.product_events TO service_role;
