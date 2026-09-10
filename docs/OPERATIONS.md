# 운영 가이드

이 문서는 현재 코드의 운영 계약입니다. 이 저장소에서는 외부 배포·스테이징 쓰기·실DB 변경을 수행하지 않습니다. 해당 변경은 지정된 운영자가 [출시 체크리스트](GO_LIVE_CHECKLIST.md)에 따라 별도로 실행합니다.

## 환경 변수

| 변수 | 범위 | 용도 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저·서버 | 공개 Supabase URL. `next build` 때 브라우저 번들에 고정됩니다. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저·서버 | 공개 anon key. 권한은 RLS가 보호합니다. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | 브라우저·서버 | GA4 측정 ID(`G-`로 시작). 빌드 때 브라우저 번들에 고정됩니다. 비우면 Google 태그를 넣지 않습니다. |
| `NEXT_PUBLIC_GA_DEBUG` | 브라우저·서버 | `1`이면 GA4 DebugView를 켭니다. 프로덕션 빌드에는 넣지 않습니다. |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 | 신뢰된 Route Handler와 운영 스크립트의 서비스 역할 키입니다. |
| `CRON_SECRET` | 서버 전용 | 스케줄러 `GET /api/cron`의 Bearer 인증 키입니다. |
| `EVENT_HASH_SALT` | 서버 전용 | 이벤트 식별자를 가명화하는 고엔트로피 salt입니다. |
| `PARTICIPANT_SESSION_SECRET` | 서버 전용 | 최소 32자의 참여자 쿠키 HMAC 서명 키입니다. 프로덕션에서 필수입니다. |
| `ADMIN_EMAILS` | 서버 전용 | 프로덕션 관리자 Supabase Auth 이메일 허용 목록입니다. |
| `DEV_ADMIN_EMAILS` | 비프로덕션 서버 전용 | `ADMIN_EMAILS`가 비어 있을 때만 쓰는 개발용 허용 목록입니다. |
| `SUPABASE_URL` | 안전한 셸·CI | 서비스 역할 운영 스크립트의 명시적 대상입니다. |
| `TEST_BASE_URL` | 안전한 셸·CI | 변경형 E2E의 명시적 HTTPS 앱 대상입니다. |
| `TEST_TARGET_ENV` | 안전한 셸·CI | 변경형 E2E 대상입니다. `local`은 loopback URL과 `--confirm-local-write`, `staging`은 선언 hostname과 `--confirm-staging-write`를 함께 요구합니다. |
| `TEST_STAGING_APP_HOST` | 안전한 셸·CI | `TEST_BASE_URL`과 정확히 일치해야 하는 선언 hostname입니다. |
| `TEST_STAGING_SUPABASE_HOST` | 안전한 셸·CI | `SUPABASE_URL`과 정확히 일치해야 하는 선언 hostname입니다. |
| `CLEANUP_SUPABASE_HOST` | 안전한 셸·CI | 파괴적 정리 스크립트에서 `SUPABASE_URL`과 정확히 일치해야 하는 선언 hostname입니다. |

`.env.example`을 복사해 무시된 `.env.local`을 만들고 비밀 관리 도구나 배포 플랫폼에만 실제 값을 저장합니다. 서비스 역할 키, 참여자 서명 키, cron 키, 이벤트 salt를 `NEXT_PUBLIC_`로 노출하거나 문서·스크립트·이슈·채팅에 기록하지 마세요.

## 참여자 세션과 관리자 권한

`src/lib/supabase/client.ts`는 anon-key 브라우저 클라이언트만 만들고, `server-only`인 `src/lib/supabase/server.ts`만 서비스 역할 클라이언트를 만듭니다.

관리 Handler는 `src/lib/admin-auth.ts`의 `requireAdminUser()`를 호출합니다. 이는 `auth.getUser()`의 쿠키 기반 신원, 확인된 이메일, 정규화된 `ADMIN_EMAILS`를 함께 확인합니다. 프로덕션에서 비어 있는 허용 목록과 알 수 없는 사용자는 거부됩니다. 클라이언트 제공 이메일, `getSession()`만의 결과, 사용자 메타데이터로 권한을 부여하지 마세요. 승객은 계정이 없으므로 Supabase Auth **공개 가입을 끕니다**. 운영자 계정은 Studio에서만 만듭니다.

카탈로그는 처음 온 사용자에게 HMAC 서명 참여자 쿠키를 발급합니다. 쿠키는 7일, `HttpOnly`, `SameSite=Strict`이며 프로덕션에서는 `Secure`와 `__Host-kkinggitaja-participant` 이름을 사용합니다. 참여자 Handler는 이 쿠키에서만 신원을 얻고, 참여자 ID는 URL·브라우저 저장소·요청 본문·API 응답에 나타나면 안 됩니다.

## 카탈로그와 매칭

현재 파일럿 배포 계약은 승차 지점 `spot_a`만 활성화하는 것입니다. `20260908083843_spot_a_only_pilot.sql`이 이를 강제하며, 운영자는 승차 지점을 임의 삭제하지 않습니다. 다른 승차 지점은 과거 참조 보존을 위해 비활성 상태로 유지합니다.

하차 지점은 자유 입력이 아닌 관리형 카탈로그입니다. 활성 승차 지점, `active` 하차 지점, 해당 경로의 완전한 요금표가 모두 있을 때만 승객에게 노출됩니다. 관리자는 하차 지점을 생성·편집·재정렬하고 `draft`/`active`/`inactive` 상태를 바꿉니다. `active`에는 모든 활성 승차 지점의 요금표가 필요합니다.

`fast`와 `cheap`은 같은 승차·하차 경로의 대기 풀을 공유합니다. DB 함수가 advisory lock 안에서 후보 선택과 시간 초과 정리를 처리하며, 서로 다른 엔트리 2개 이상을 일행 분리 없이 총 2~4명으로 제안합니다.

- 4명 조합은 즉시 제안합니다.
- 2~3명은 전원이 `fast`일 때 즉시 제안합니다.
- `cheap`이 포함된 2~3명은 가장 오래된 3분 제한시간 뒤에만 제안합니다.
- 제안은 20초 뒤 만료하며, 미응답 엔트리는 `paused`가 되어 사용자가 재개해야 합니다.

검증되지 않은 하드코딩 버스 시간·혼잡도 추정은 제거되어 있으며 운영 수치나 사용자 API에 사용하지 않습니다.

## 헤더와 요청 제한

`src/proxy.ts`는 요청마다 nonce를 만들고 `x-nonce`와 요청 CSP 헤더를 Next에 함께 전달합니다. 루트 레이아웃은 요청 시 렌더링을 강제해 Next 프레임워크·앱 스크립트가 같은 nonce를 받도록 합니다. 따라서 페이지 응답은 정적 HTML로 캐시하면 안 되며, 브라우저에서 응답 CSP nonce와 모든 스크립트 태그의 nonce가 일치하는지 확인해야 합니다. CSP는 스크립트 nonce, 자체 호스팅 글꼴, 설정된 Supabase URL만 이미지·realtime 연결에 허용합니다. `NEXT_PUBLIC_GA_MEASUREMENT_ID`가 있으면 Google Analytics 수집 호스트를 `img-src`와 `connect-src`에 추가합니다. `gtag.js`는 nonce와 `strict-dynamic`으로 로드되며 광고 신호는 끕니다. `/admin`에는 태그를 넣지 않고, `/waiting/*`와 `/team/*`의 식별자는 `_`로 가립니다. GA 쿠키는 세션 만료입니다. 현재 `style-src 'unsafe-inline'`은 CSS 인라인 스타일 호환을 위해 남아 있습니다.

`next.config.ts`는 `nosniff`, 프레임 차단, referrer·permissions 정책을 제공하고 프로덕션에서 HSTS를 더합니다. proxy rate limiter는 실행 인스턴스 메모리 기반 버스트 완화 장치일 뿐 서버리스 인스턴스 전체 제한이 아닙니다. 전역 남용 방어를 주장하려면 출시 전에 공유 rate-limit 저장소를 연결해야 합니다.

## 검증과 스크립트 안전성

```bash
npm run lint
npx tsc --noEmit
npm run build

# 기본값은 localhost에 대한 읽기 전용 부하 확인입니다.
node scripts/load-test.mjs

# 큐를 만드는 로컬 여정은 명시적으로만 실행합니다.
node scripts/load-test.mjs --run-journey
```

서비스 역할을 쓰는 스크립트는 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 없으면 요청 전에 실패합니다. 정식 E2E(`scripts/e2e-flow-test.mjs`)는 로컬과 스테이징 중 하나를 명시적으로 선택해야 하며 기본 대상이 없습니다. 로컬은 loopback 앱·Supabase URL과 `--confirm-local-write`, 스테이징은 명시적 HTTPS 앱 URL·선언 hostname·`--confirm-staging-write`를 요구합니다. 프로덕션에는 변경형 E2E를 실행하지 마세요. 정확한 실행 계약은 [출시 체크리스트](GO_LIVE_CHECKLIST.md)의 현재 명령을 사용합니다.

`scripts/pre-deploy-cleanup.mjs`는 기본 실행을 거부합니다. `SUPABASE_URL`의 실제 hostname과 정확히 같은 `CLEANUP_SUPABASE_HOST`도 요구합니다. 먼저 `--dry-run`으로 대상을 확인하고, 승인된 백업과 연결 프로젝트를 별도로 확인한 운영자만 `--confirm-delete-all-matching-data`를 사용합니다. 최종 스키마의 노쇼·제품 이벤트·`match_daily_counters`까지 참조 순서에 맞게 삭제하므로 다음 팀 번호는 서비스 날짜별 1번부터 시작하며, 존재하지 않는 레거시 RPC나 SQL Editor 수동 작업에 의존하지 않습니다. 어떤 단계든 실패하거나 삭제 대상 행이 남으면 종료 코드가 실패합니다. 이를 마이그레이션 롤백 수단으로 사용하지 않습니다.

## 장애 대응 원칙

1. 비밀값 노출 의심 시 서비스 역할 키·cron 키·참여자 서명 키를 교체하고 해당 배포 환경 변수를 폐기한 뒤 접근 로그를 점검합니다.
2. 권한 사고 시 해당 `ADMIN_EMAILS` 항목을 제거하고 Supabase Auth 세션을 철회한 뒤 데이터를 바꾸기 전에 로그를 보존합니다.
3. 매칭 이상 시 스케줄 호출을 멈추고 관련 대기·매치 레코드를 보존한 뒤 스테이징에서 재현합니다.
4. 배포 실패는 먼저 애플리케이션 릴리스를 되돌립니다. 데이터 복구는 검증된 백업 또는 migration별 복구 계획으로만 수행하며 임의의 테이블 삭제·광범위 정리를 하지 않습니다.
