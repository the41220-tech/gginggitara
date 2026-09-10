-- =====================================================
-- Heartbeat & Matching Engine Locking
-- 비활성 사용자 감지 + 동시성 제어
-- =====================================================

-- 1. queue_entries에 last_active_at 컬럼 추가
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now();

-- 2. last_active_at 인덱스 (비활성 사용자 조회 성능)
CREATE INDEX IF NOT EXISTS idx_queue_entries_last_active
  ON queue_entries (last_active_at)
  WHERE status IN ('waiting', 'matched');

-- 3. 복합 인덱스: 매칭 엔진 조회 최적화
CREATE INDEX IF NOT EXISTS idx_queue_entries_matching
  ON queue_entries (pickup_spot_id, drop_zone_id, status, created_at)
  WHERE status = 'waiting';

-- =====================================================
-- Advisory Lock RPC functions
-- 매칭 엔진 분산 동시성 제어
-- =====================================================

-- Lock key: 고정 숫자. 모든 인스턴스가 동일 키로 lock을 시도함.
-- pg_try_advisory_lock은 non-blocking: 이미 lock이 걸려있으면 false 반환.

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
-- threshold_seconds초 동안 heartbeat 없는 waiting 사용자를 expired로 변경
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
-- Atomic matching: 대상 entries를 한번에 waiting→matched로 변경
-- 이미 다른 프로세스에 의해 매칭된 entry는 스킵 (optimistic locking)
-- 반환값: 실제로 업데이트된 row 수
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
    AND status = 'waiting';  -- 핵심: waiting 상태인 것만 업데이트

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
