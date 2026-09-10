-- =====================================================
-- Security Hardening: RLS Policy Strengthening
-- 
-- 기존 USING(true) 정책을 service_role only로 강화합니다.
-- 모든 데이터 조작은 서버 사이드 API 라우트(service_role)를 통해서만 가능합니다.
-- anon key로 직접 Supabase에 접근하는 공격자를 전면 차단합니다.
-- =====================================================

-- ===== queue_entries =====

-- INSERT: service_role만 허용
DROP POLICY IF EXISTS "Users can insert queue_entries" ON queue_entries;
CREATE POLICY "Server insert queue_entries" ON queue_entries
  FOR INSERT WITH CHECK (
    current_setting('role') = 'service_role'
  );

-- SELECT: service_role만 허용
DROP POLICY IF EXISTS "Public read access for queue_entries" ON queue_entries;
CREATE POLICY "Server read queue_entries" ON queue_entries
  FOR SELECT USING (
    current_setting('role') = 'service_role'
  );

-- UPDATE: service_role만 허용
DROP POLICY IF EXISTS "Users can update queue_entries" ON queue_entries;
CREATE POLICY "Server update queue_entries" ON queue_entries
  FOR UPDATE USING (
    current_setting('role') = 'service_role'
  );

-- ===== matches =====

-- SELECT: service_role만 허용
DROP POLICY IF EXISTS "Public read access for matches" ON matches;
CREATE POLICY "Server read matches" ON matches
  FOR SELECT USING (
    current_setting('role') = 'service_role'
  );

-- INSERT: service_role만 허용 (매칭 엔진에서만 생성)
CREATE POLICY "Server insert matches" ON matches
  FOR INSERT WITH CHECK (
    current_setting('role') = 'service_role'
  );

-- UPDATE: service_role만 허용
DROP POLICY IF EXISTS "Users can update matches status" ON matches;
CREATE POLICY "Server update matches" ON matches
  FOR UPDATE USING (
    current_setting('role') = 'service_role'
  );

-- ===== reports =====

-- INSERT: service_role만 허용
DROP POLICY IF EXISTS "Users can insert reports" ON reports;
CREATE POLICY "Server insert reports" ON reports
  FOR INSERT WITH CHECK (
    current_setting('role') = 'service_role'
  );

-- SELECT: service_role만 허용 (관리자 대시보드용)
CREATE POLICY "Server read reports" ON reports
  FOR SELECT USING (
    current_setting('role') = 'service_role'
  );

-- ===== blocked_sessions =====
-- (기본적으로 deny all이지만, 명시적으로 service_role만 허용)

CREATE POLICY "Server manage blocked_sessions" ON blocked_sessions
  FOR ALL USING (
    current_setting('role') = 'service_role'
  );

-- ===== fare_table =====
-- 읽기는 공개 유지 (요금 조회는 공개 정보), 수정은 service_role만
DROP POLICY IF EXISTS "Public read access for fare_table" ON fare_table;
CREATE POLICY "Public read fare_table" ON fare_table
  FOR SELECT USING (true);

CREATE POLICY "Server update fare_table" ON fare_table
  FOR UPDATE USING (
    current_setting('role') = 'service_role'
  );

-- ===== pickup_spots & drop_zones =====
-- 읽기는 공개 유지 (UI에서 사용), 수정 불가
-- (기존 정책 유지: Public read access)


-- =====================================================
-- Security: Reports 중복 신고 방지 UNIQUE 제약
-- =====================================================

ALTER TABLE reports 
  ADD CONSTRAINT unique_report_per_session_match 
  UNIQUE (reporter_session_id, match_id);
