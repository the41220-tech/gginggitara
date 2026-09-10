# 프로덕션 출시 체크리스트

이 저장소에서는 스테이징 테스트, 외부 배포, 실DB 마이그레이션을 실행하지 않았습니다. 아래 항목은 지정된 운영자가 스테이징에서 완료하고 증적을 남긴 뒤 프로덕션 유지보수 창에서 반복할 작업입니다.

## 1. 비밀값과 접근 설정

- [ ] 과거에 노출됐을 가능성이 있는 Supabase 서비스 역할 키와 `CRON_SECRET`을 먼저 교체한다.
- [ ] 고유한 `PARTICIPANT_SESSION_SECRET`(최소 32자)과 `EVENT_HASH_SALT`를 생성해 서버 전용 환경 변수로 설정한다.
- [ ] 공개 빌드 환경에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 설정한다. 빌드 뒤에는 값이 번들에 고정됨을 확인한다.
- [ ] GA4를 쓸 경우 공개 빌드 환경에 `NEXT_PUBLIC_GA_MEASUREMENT_ID`(`G-`로 시작)를 설정하고, 배포 후 공개 페이지 소스에 `gtag.js`와 해당 측정 ID가 있는지 확인한다. `/admin`에는 태그가 없어야 한다. 광고 기능·Google 신호는 코드에서 꺼져 있다. GA4 속성에서 향상된 측정 중 양식 상호작용은 끈다.
- [ ] 서버 환경에만 `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `PARTICIPANT_SESSION_SECRET`, `EVENT_HASH_SALT`, `ADMIN_EMAILS`를 설정한다.
- [ ] 실제 운영자 Supabase Auth 이메일만 `ADMIN_EMAILS`에 넣고, 프로덕션에는 `DEV_ADMIN_EMAILS`에 의존하지 않는다.
- [ ] 호스팅된 Supabase 프로젝트에서 Authentication → 공개 이메일 가입을 끈다. 로컬 `config.toml`은 `enable_signup = false`이다. 클라우드 대시보드 값은 마이그레이션과 별개이므로 직접 확인한다.
- [ ] 변경형 테스트에는 전용 스테이징을 쓰고 `TEST_TARGET_ENV=staging`, `TEST_STAGING_APP_HOST`, `TEST_STAGING_SUPABASE_HOST`를 실제 대상과 정확히 일치시킨다. 이 변수들은 URL 일치만 검사하므로 운영자가 대상 프로젝트가 스테이징임을 별도로 확인한다.
- [ ] `.env*`, CI 로그, 테스트 출력, 배포 변수에 서비스 역할 키·서명 키·cron 키가 남지 않았는지 확인한다.

## 2. Supabase 추가형 마이그레이션

1. 운영과 동등한 Auth, RLS, Realtime, 스케줄 설정을 가진 별도 스테이징 Supabase 프로젝트를 준비한다.
2. 프로덕션 복원 담당자와 복원 시점을 정하고 관리형 백업/내보내기 상태를 확인한다.
3. `supabase/migrations/`를 시간순으로 검토한다. 이번 릴리스의 서버 권위 매칭·카탈로그 변경은 `20260908004102_server_authoritative_matching.sql`, 이벤트·지표 변경은 `20260908004939_product_events.sql`, Spot A 단독 파일럿 전환은 `20260908083843_spot_a_only_pilot.sql`이다. 마지막 migration은 `spot_a` 존재를 먼저 검사하고, 모든 다른 승차 지점을 비활성화한 뒤 활성 승차 지점이 정확히 하나인지 다시 검사한다.
4. 연결 대상이 스테이징임을 확인한 뒤 CLI로 적용한다.

```bash
npx supabase migration list --linked
npx supabase db push --dry-run
npx supabase db push
```

5. `NOT VALID` 제약은 새·수정 행에는 즉시 적용되지만 기존 행 전체 검증은 별도입니다. 스테이징에서 아래 검증을 모두 통과시킨 뒤에만 프로덕션에서 실행합니다. 실패하면 행을 조사·수정하고, 제약을 삭제하거나 우회하지 않습니다.

```sql
ALTER TABLE public.drop_zones VALIDATE CONSTRAINT drop_zones_catalog_values_check;
ALTER TABLE public.queue_entries VALIDATE CONSTRAINT queue_entries_status_check;
ALTER TABLE public.queue_entries VALIDATE CONSTRAINT queue_entries_match_state_check;
ALTER TABLE public.matches VALIDATE CONSTRAINT matches_status_check;
ALTER TABLE public.matches VALIDATE CONSTRAINT matches_capacity_check;
ALTER TABLE public.matches VALIDATE CONSTRAINT matches_offer_state_check;
ALTER TABLE public.fare_table VALIDATE CONSTRAINT fare_table_values_check;
```

6. 스테이징 결과, CLI 출력, 제약 검증 결과를 배포 기록에 보관한다. 프로덕션에서는 새 백업 직후 같은 순서로 한 번만 적용한다. 실패 시 트래픽 변경을 멈추고 검증된 복구 계획으로 돌아간다.

Spot A 단독 상태는 스테이징과 프로덕션에서 아래 쿼리 결과가 `spot_a | true`, 활성 개수가 `1`일 때만 통과입니다.

```sql
SELECT id, name, active FROM public.pickup_spots ORDER BY id;
SELECT count(*) AS active_pickup_count FROM public.pickup_spots WHERE active = true;
```

## 3. 플랫폼과 관측 설정

- [ ] `GET /api/cron` 스케줄러에 `Authorization: Bearer <CRON_SECRET>`를 설정하고 호출 주기·담당자·실패 알림을 기록한다.
- [ ] 앱 요청 시간 제한이 매칭 정리와 재매칭에 충분한지 확인한다.
- [ ] 오류율, 가용성, cron 실패, 대기 시간, 매칭 실패 알림과 담당자를 설정한다.
- [ ] HTTPS를 강제하는 배포 대상을 설정한다. HSTS는 프로덕션 빌드에서만 전송된다.
- [ ] 현재 인스턴스 메모리 제한 외에 공유 rate-limit 저장소를 연결하거나 그 제한을 운영 위험으로 승인한다. 현 구현만으로 전역 남용 방어라고 표기하지 않는다.
- [ ] 모든 관리자 Route Handler가 `requireAdminUser()`를 통과하는지 확인한다. 인증된 Supabase 사용자가 자동으로 관리자가 되는 것은 아니다.

## 4. 스테이징 스모크 테스트

전용 스테이징과 명시적 환경 변수로만 실행합니다.

```bash
SUPABASE_URL=https://staging-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
TEST_BASE_URL=https://staging.example.com \
TEST_TARGET_ENV=staging \
TEST_STAGING_APP_HOST=staging.example.com \
TEST_STAGING_SUPABASE_HOST=staging-project.supabase.co \
node scripts/e2e-flow-test.mjs --confirm-staging-write
```

스크립트는 활성 카탈로그 경로를 찾고, 합성 사용자별 HttpOnly 쿠키 jar를 유지하며, 서버 권위 제안부터 정산·신고까지 실행한 뒤 자신이 만든 엔트리·매치 ID만 정리합니다. 참여자 ID를 URL이나 요청 본문으로 받지 않습니다. 프로덕션에는 실행하지 마세요.

동일 흐름을 로컬에서 재현할 때는 로컬 주소와 로컬 Supabase만 명시적으로 허용하는 다음 명령을 사용합니다.

```bash
TEST_TARGET_ENV=local \
TEST_BASE_URL=http://127.0.0.1:3000 \
node --env-file=.env.development.local scripts/e2e-flow-test.mjs --confirm-local-write
```

2026-09-08 로컬 검증에서는 1+1 빠른 출발, 양측 수락, 멤버십 격리, 양측 도착·출발, 정산, 신고 멱등성, 제안 만료·재개·취소, 잘못된 입력이 모두 통과했습니다. 프로덕션 빌드 화면 증적은 [Spot A 파일럿 QA 보고서](QA_SPOT_A_PILOT_2026-09-08.md)에 기록했습니다.

브라우저에서 다음을 직접 확인합니다.

1. 새 사용자가 활성 승차·하차 지점을 고르고 대기에 들어간 뒤 새로고침해도 같은 대기 상태를 복구한다.
2. `1+1 fast` 즉시 제안, `1+1 cheap`의 3분 대기 후 제안, `3+1`, `3+2` 용량 충돌, 일행 분리 금지를 확인한다.
3. 제안을 수락·거절·만료해도 오래된 팀이 남지 않는다.
4. 매치 멤버가 아닌 사용자는 매치·정산을 읽지 못하고, 노쇼는 정산 계좌를 읽지 못한다.
5. 운영자가 하차 지점을 생성·편집·순서 변경·비활성화하고, 비활성화가 기존 매치를 바꾸지 않는다.
6. 320px, 375px, 768px, 1280px에서 가로 넘침, 키보드 포커스, 대화상자 포커스 복귀, reduced motion을 확인한다.
7. 페이지가 동적 응답이며, 응답 CSP nonce와 모든 Next 스크립트 태그의 nonce가 일치하고, `nosniff`, 프레임 차단, 프로덕션 HSTS가 있으며 브라우저 콘솔에 CSP 위반이 없는지 확인한다.

검증되지 않은 하드코딩 버스 시간·혼잡도 추정은 제거됐으므로 출시 전 데이터 확인 대상이 아닙니다.

## 5. 최종 출시 결정

1. 깨끗한 환경에서 `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm audit`, `npm audit --omit=dev`를 실행한다.
2. 아래 비밀값 스캔은 소스 파일 매치가 없어야 한다.
3. 스테이징 증적과 지정 운영자의 승인을 받은 뒤에만 출시한다.
4. 백업, 비밀값 교체, 마이그레이션·제약 검증, cron, 경보, 롤백 담당자가 모두 준비됐을 때만 프로덕션 변경 창을 연다.
5. 출시 창에는 오류율, cron 결과, 대기 시간, 매칭 실패를 감시한다.

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!.env.local' \
  'eyJ[a-zA-Z0-9._-]{20,}|sb_secret_[a-zA-Z0-9_-]{10,}' .
```
