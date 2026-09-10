-- =====================================================
-- Fix RLS Policies: queue_entries, matches, reports, blocked_sessions
-- 
-- current_setting('role') = 'service_role' 패턴 제거
-- → WITH CHECK (false) / USING (false) 패턴으로 교체
-- service_role은 RLS bypass이므로 API route에서 정상 동작
-- =====================================================

-- ===== queue_entries =====
DROP POLICY IF EXISTS "Users can insert queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Server insert queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Service insert queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "allow_select_queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "deny_insert_queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "deny_update_queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "deny_delete_queue_entries" ON queue_entries;

DROP POLICY IF EXISTS "Public read access for queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Server read queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Public read queue_entries" ON queue_entries;

DROP POLICY IF EXISTS "Users can update queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Server update queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Service update queue_entries" ON queue_entries;
DROP POLICY IF EXISTS "Service delete queue_entries" ON queue_entries;

CREATE POLICY "allow_select_queue_entries" ON queue_entries FOR SELECT USING (true);
CREATE POLICY "deny_insert_queue_entries" ON queue_entries FOR INSERT WITH CHECK (false);
CREATE POLICY "deny_update_queue_entries" ON queue_entries FOR UPDATE USING (false);
CREATE POLICY "deny_delete_queue_entries" ON queue_entries FOR DELETE USING (false);

-- ===== matches =====
DROP POLICY IF EXISTS "Public read access for matches" ON matches;
DROP POLICY IF EXISTS "Server read matches" ON matches;
DROP POLICY IF EXISTS "Public read matches" ON matches;
DROP POLICY IF EXISTS "Server insert matches" ON matches;
DROP POLICY IF EXISTS "Service insert matches" ON matches;
DROP POLICY IF EXISTS "Users can update matches status" ON matches;
DROP POLICY IF EXISTS "Server update matches" ON matches;
DROP POLICY IF EXISTS "Service update matches" ON matches;
DROP POLICY IF EXISTS "allow_select_matches" ON matches;
DROP POLICY IF EXISTS "deny_insert_matches" ON matches;
DROP POLICY IF EXISTS "deny_update_matches" ON matches;

CREATE POLICY "allow_select_matches" ON matches FOR SELECT USING (true);
CREATE POLICY "deny_insert_matches" ON matches FOR INSERT WITH CHECK (false);
CREATE POLICY "deny_update_matches" ON matches FOR UPDATE USING (false);

-- ===== reports =====
DROP POLICY IF EXISTS "Users can insert reports" ON reports;
DROP POLICY IF EXISTS "Server insert reports" ON reports;
DROP POLICY IF EXISTS "Service insert reports" ON reports;
DROP POLICY IF EXISTS "Server read reports" ON reports;
DROP POLICY IF EXISTS "Service read reports" ON reports;
DROP POLICY IF EXISTS "deny_select_reports" ON reports;
DROP POLICY IF EXISTS "deny_insert_reports" ON reports;

CREATE POLICY "deny_select_reports" ON reports FOR SELECT USING (false);
CREATE POLICY "deny_insert_reports" ON reports FOR INSERT WITH CHECK (false);

-- ===== blocked_sessions =====
DROP POLICY IF EXISTS "Server manage blocked_sessions" ON blocked_sessions;
DROP POLICY IF EXISTS "Service manage blocked_sessions" ON blocked_sessions;
DROP POLICY IF EXISTS "deny_all_blocked_sessions" ON blocked_sessions;

CREATE POLICY "deny_all_blocked_sessions" ON blocked_sessions FOR ALL USING (false);
