-- =====================================================
-- Missing RPC Functions + get_next_team_number
-- heartbeat_and_locking.sql의 내용 + 누락된 get_next_team_number
-- =====================================================

-- 1. queue_entries에 last_active_at 컬럼 추가
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now();

-- 2. last_active_at 인덱스
CREATE INDEX IF NOT EXISTS idx_queue_entries_last_active
  ON queue_entries (last_active_at)
  WHERE status IN ('waiting', 'matched');

-- 3. 복합 인덱스: 매칭 엔진 조회 최적화
CREATE INDEX IF NOT EXISTS idx_queue_entries_matching
  ON queue_entries (pickup_spot_id, drop_zone_id, status, created_at)
  WHERE status = 'waiting';

-- =====================================================
-- Advisory Lock RPC functions
-- =====================================================

CREATE OR REPLACE FUNCTION try_acquire_matching_lock()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_try_advisory_lock(7777777);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION release_matching_lock()
RETURNS VOID AS $$
BEGIN
  PERFORM pg_advisory_unlock(7777777);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 비활성 사용자 일괄 만료 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION expire_inactive_entries(threshold_seconds INTEGER DEFAULT 60)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE queue_entries
  SET status = 'expired'
  WHERE status = 'waiting'
    AND last_active_at < now() - (threshold_seconds || ' seconds')::INTERVAL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Atomic matching RPC
-- =====================================================

CREATE OR REPLACE FUNCTION atomic_match_entries(
  entry_ids UUID[],
  target_match_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE queue_entries
  SET status = 'matched', match_id = target_match_id
  WHERE id = ANY(entry_ids)
    AND status = 'waiting';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 팀 번호 채번 (matching.ts에서 호출하지만 정의 누락)
-- =====================================================

CREATE OR REPLACE FUNCTION get_next_team_number()
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(team_number), 0) + 1 INTO next_num FROM matches;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
