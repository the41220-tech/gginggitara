# 낑기타자

부산대역의 정해진 승차 지점에서 관리형 하차 지점까지 가는 익명 택시 동승 서비스입니다. 사용자는 하차 지점, 일행 인원, 출발 우선순위를 고르고 대기·제안·집합·출발·정산까지 한 흐름으로 진행합니다. 운영자는 하차 지점과 요금표, 대기열, 매칭 현황과 지표를 관리합니다.

현재 앱 버전은 `0.1.1`입니다. 출처는 GitHub 저장소이며, 배포 전에 `VERSION`·`CHANGELOG.md`·git 태그를 확인합니다.

## 기술 구성

- Next.js `16.3.4`, React `19.2.4`, TypeScript
- Supabase Auth 및 Postgres. 서버 전용 서비스 역할 클라이언트가 카탈로그·매칭 전환을 수행합니다.
- Next App Router의 Route Handler는 `src/app/api/**/route.ts`에 있습니다.

## 로컬 실행

Next.js가 요구하는 Node.js `20.9.0` 이상을 사용합니다. 이 작업물은 Node.js `22.20.0`에서 검증했습니다.

```bash
npm install
supabase start
npm run dev -- --hostname 127.0.0.1
```

브라우저에서 `http://127.0.0.1:3000/join`을 엽니다. 이 작업공간은 `supabase/config.toml`과 migration으로 로컬 카탈로그를 재현하며, 현재 컴퓨터에는 로컬 연결용 `.env.development.local`이 준비되어 있습니다. 검증된 운영자 로그인 정보는 Git에서 제외된 `.env.local-admin.qa`에서 확인합니다. 로컬 DB를 초기화하면 Auth 사용자도 사라지므로 운영자 계정을 다시 만들어야 합니다.

- 고객 화면: `http://127.0.0.1:3000/join`
- 운영자 로그인: `http://127.0.0.1:3000/admin`
- 로컬 Supabase Studio: `http://127.0.0.1:54323`

`.env.development.local`과 `.env.local-admin`은 로컬 전용이며 커밋하지 않습니다. 새 컴퓨터에서 설정하는 방법과 관리자 계정 재생성 절차는 [운영자 기능·로직 설명서](docs/운영자-기능-로직-설명서.md)를 따릅니다. `NEXT_PUBLIC_*` 값은 브라우저 번들에 들어가므로 빌드 환경마다 설정하고, 나머지 비밀값에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

```bash
npm run lint
npx tsc --noEmit
npm run build
```

필수 환경 변수와 용도, 배포 전 값 설정은 [운영 가이드](docs/OPERATIONS.md)를 따릅니다.

## 사용자 흐름과 매칭 규칙

하차 지점은 자유 입력이 아닙니다. 활성 승차 지점과 활성 하차 지점, 해당 경로의 요금표가 모두 있을 때만 카탈로그에 노출됩니다. 관리자는 `/admin/dashboard`에서 하차 지점을 생성·편집·정렬하고 초안/활성/비활성 상태를 바꿉니다. 활성화에는 모든 활성 승차 지점의 요금표가 필요합니다.

`fast`와 `cheap`은 같은 승차·하차 경로의 하나의 대기 풀을 공유합니다. 서버 DB 함수가 서로 다른 대기 엔트리 두 개 이상을 묶되, 일행을 쪼개지 않고 총 2~4명만 제안합니다.

- 총 4명 조합은 우선순위와 관계없이 즉시 제안합니다.
- 총 2~3명은 구성원 모두 `fast`일 때 즉시 제안합니다.
- `cheap`이 포함된 2~3명 조합은 가장 오래된 대기 제한시간인 3분이 지난 뒤 제안합니다.
- 제안 응답 시간은 20초입니다. 응답을 놓친 엔트리는 자동으로 일시정지되며, 사용자가 같은 조건으로 재개하거나 취소할 수 있습니다.

요금은 등록된 경로의 예상 범위이며, 출발 뒤 실제 택시비를 정산에 기록합니다. 검증되지 않은 하드코딩 버스 시간·대기열 추정치는 제거했으며 API와 화면에 제공하지 않습니다.

## 세션과 권한

카탈로그를 처음 읽을 때 서버가 서명한 참여자 쿠키를 발급합니다. 이 쿠키는 `HttpOnly`, `SameSite=Strict`, 7일 수명이며 프로덕션에서는 `Secure` 및 `__Host-` 이름을 사용합니다. 참여자 ID를 URL, 요청 본문, 브라우저 저장소 또는 API 응답으로 전달하지 않습니다.

관리자는 Supabase Auth 세션과 `ADMIN_EMAILS` 허용 목록을 모두 만족해야 합니다. 인증된 사용자라고 해서 관리자가 되는 것은 아닙니다.

## 안전한 스크립트

```bash
# 기본값은 localhost에 대한 읽기 전용 부하 확인입니다.
node scripts/load-test.mjs

# 로컬에서만 큐 생성 여정을 명시적으로 실행합니다.
node scripts/load-test.mjs --run-journey
```

스테이징 E2E의 정확한 환경 계약과 실행 명령은 [출시 체크리스트](docs/GO_LIVE_CHECKLIST.md)를 따릅니다. 운영 환경에는 변경형 테스트를 실행하지 마세요.

## 문서

- [고객 이용 안내서](docs/고객-이용안내서.md)
- [운영자 기능·로직 설명서](docs/운영자-기능-로직-설명서.md)
- [디자인 시스템](DESIGN.md)
- [운영 가이드](docs/OPERATIONS.md)
- [출시 체크리스트](docs/GO_LIVE_CHECKLIST.md)
- [Spot A 파일럿 QA 보고서](docs/QA_SPOT_A_PILOT_2026-09-08.md)
- [승인된 제품·구현 명세](docs/superpowers/specs/2026-09-08-gginggitara-production-redesign-design.md)
- [변경 기록](CHANGELOG.md)

## 버전 관리

- 앱 버전: `VERSION`과 `package.json` `version` (지금 `0.1.1`)
- 변경 요약: `CHANGELOG.md`
- 릴리스 태그: `v0.1.1`처럼 `v` + 버전

새 수정을 남길 때:

1. `VERSION`과 `package.json` 버전을 같이 올린다.
2. `CHANGELOG.md` 맨 위에 항목을 추가한다.
3. 커밋한 뒤 `git tag vX.Y.Z` 하고 GitHub에 push한다.

Vercel 프로덕션 URL은 `https://gginggitara-production.vercel.app`입니다. GitHub와 연결하면 `main` push로 배포할 수 있습니다. 지금은 CLI로 올린 배포와 git 태그가 자동으로 묶여 있지 않습니다.
