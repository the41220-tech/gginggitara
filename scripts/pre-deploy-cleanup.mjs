/**
 * 낑기타자 프로덕션 배포 전 DB 정리 스크립트
 *
 * 수행 작업:
 *   1. reports, product_events, noshow_events, settlements 전체 삭제
 *   2. queue_entries와 matches 전체 삭제
 *   3. blocked_sessions 전체 삭제
 *   4. 일별 팀 번호 카운터 전체 삭제
 *
 * 사용법:
 *   CLEANUP_SUPABASE_HOST에는 SUPABASE_URL과 같은 hostname을 지정한다.
 *   node scripts/pre-deploy-cleanup.mjs --dry-run  # 삭제 없이 현황만 확인
 *   node scripts/pre-deploy-cleanup.mjs --confirm-delete-all-matching-data
 */

import { createClient } from '@supabase/supabase-js';
import { loadCleanupEnvironment } from './environment.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRMED = process.argv.includes('--confirm-delete-all-matching-data');

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/pre-deploy-cleanup.mjs --dry-run | --confirm-delete-all-matching-data');
  process.exit(0);
}
if (DRY_RUN === CONFIRMED) {
  throw new Error('Choose exactly one mode: --dry-run or --confirm-delete-all-matching-data.');
}

const {
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_KEY,
} = loadCleanupEnvironment();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getCount(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table} 건수 확인 실패: ${error.message}`);
  return count ?? 0;
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     낑기타자 프로덕션 DB 정리 스크립트                     ║');
  console.log(`║     모드: ${DRY_RUN ? 'DRY RUN (삭제 안 함)' : '🔴 실제 삭제'}${''.padEnd(DRY_RUN ? 30 : 38)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 현황 파악 ──
  const tables = ['queue_entries', 'matches', 'settlements', 'reports', 'blocked_sessions', 'noshow_events', 'product_events', 'match_daily_counters'];
  console.log('📊 현재 데이터 현황:');
  for (const t of tables) {
    const count = await getCount(t);
    console.log(`  ${t}: ${count}건`);
  }

  if (DRY_RUN) {
    console.log('ℹ️  --dry-run 모드: 삭제를 수행하지 않습니다.');
    return;
  }

  // ── 삭제 실행 ──
  console.log('🗑️  데이터 삭제 시작...\n');

  // 1. reports (FK 없음)
  const { error: e1 } = await supabase.from('reports').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e1 ? '❌' : '✅'} reports 삭제 ${e1 ? '실패: ' + e1.message : '완료'}`);

  // 2. product_events (권위 데이터와 분리된 익명 제품 이벤트)
  const { error: e1a } = await supabase.from('product_events').delete().gte('occurred_at', '2000-01-01');
  console.log(`  ${e1a ? '❌' : '✅'} product_events 삭제 ${e1a ? '실패: ' + e1a.message : '완료'}`);

  // 3. noshow_events (queue_entries와 matches를 참조하므로 먼저 삭제)
  const { error: e1c } = await supabase.from('noshow_events').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e1c ? '❌' : '✅'} noshow_events 삭제 ${e1c ? '실패: ' + e1c.message : '완료'}`);

  // 4. settlements (FK: matches → CASCADE이지만 명시적 삭제)
  const { error: e1b } = await supabase.from('settlements').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e1b ? '❌' : '✅'} settlements 삭제 ${e1b ? '실패: ' + e1b.message : '완료'}`);

  // 5. queue_entries (FK 자식 행을 그대로 먼저 삭제해 상태 제약을 유지한다)
  const { error: e2 } = await supabase.from('queue_entries').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e2 ? '❌' : '✅'} queue_entries 삭제 ${e2 ? '실패: ' + e2.message : '완료'}`);

  // 6. matches
  const { error: e3 } = await supabase.from('matches').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e3 ? '❌' : '✅'} matches 삭제 ${e3 ? '실패: ' + e3.message : '완료'}`);

  // 7. blocked_sessions
  const { error: e4 } = await supabase.from('blocked_sessions').delete().gte('created_at', '2000-01-01');
  console.log(`  ${e4 ? '❌' : '✅'} blocked_sessions 삭제 ${e4 ? '실패: ' + e4.message : '완료'}`);

  // 8. 일별 팀 번호 카운터. 다음 팀은 해당 서비스 날짜의 1번부터 시작한다.
  const { error: e5 } = await supabase.from('match_daily_counters').delete().gte('service_date', '2000-01-01');
  console.log(`  ${e5 ? '❌' : '✅'} match_daily_counters 삭제 ${e5 ? '실패: ' + e5.message : '완료'}`);

  const mutationErrors = [e1, e1a, e1c, e1b, e2, e3, e4, e5].filter(Boolean);
  if (mutationErrors.length > 0) throw new Error(`데이터 정리 ${mutationErrors.length}개 단계가 실패했습니다.`);

  // ── 정리 후 확인 ──
  console.log('\n📊 정리 후 데이터 현황:');
  for (const t of tables) {
    const count = await getCount(t);
    const icon = count === 0 ? '✅' : '❌';
    console.log(`  ${icon} ${t}: ${count}건`);
  }

  const allClean = (await Promise.all(tables.map(t => getCount(t)))).every(c => c === 0);
  if (!allClean) throw new Error('정리 검증 실패: 삭제 대상 데이터가 남아 있습니다.');
  console.log(`\n  최종: ${allClean ? '🟢 DB 정리 완료 — 배포 준비 OK!' : '🔴 일부 데이터 남아있음'}\n`);
})();
