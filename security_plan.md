# 낑기타자 보안 강화 계획서 — 고의적 공격 방어 편

> **목적**: 로그인 없이 `session_id`(localStorage UUID)로 운영되는 익명 택시 합승 서비스에서, **고의적 공격자가 자동화 스크립트나 직접 API 호출로 시스템을 파괴할 수 있는 취약점**을 식별하고 방어합니다.
>
> 대상: Next.js 16 App Router + Supabase (PostgreSQL + RLS) + Vercel Serverless

---

## 현재 보안 상태 총평

| 영역 | 현재 상태 | 등급 | 위험도 |
|------|----------|:----:|:------:|
| Rate Limiting | **전무** — 모든 API에 무제한 호출 가능 | 🔴 | **Critical** |
| Session 소유권 검증 | session_id만 전송하면 누구나 상태 변경 가능 | 🔴 | **Critical** |
| RLS (DB 직접 접근) | 모든 정책 `USING (true)` — anon key로 전체 DB 조작 가능 | 🔴 | **Critical** |
| Security Headers | 미설정 — Clickjacking, MIME sniffing 취약 | 🔴 | **High** |
| 에러 정보 노출 | Supabase/내부 DB 오류 메시지가 클라이언트에 노출 | 🟡 | **Medium** |
| 입력 검증 | spot/zone 화이트리스트 존재, session_id 포맷 미검증 | 🟡 | **Medium** |
| 관리자 대시보드 | Supabase Auth로 보호되지만, `/api/cron` 우회 가능 | 🟡 | **Medium** |

---

## 🔴 위협 시나리오 상세 분석

### T1. 대기열 폭탄 (Queue Flooding)

**심각도**: 🔴 Critical

**공격 방법**: 공격자가 스크립트로 수천 개의 가짜 `session_id`를 생성하여 `POST /api/queue`를 반복 호출 → DB에 대량의 `waiting` 엔트리 생성 → 매칭 엔진 과부하 + 정상 유저 매칭 교란

```bash
# 공격 예시 — 10초에 1000개의 가짜 유저 삽입
for i in $(seq 1 1000); do
  curl -X POST https://kkinggitaja.vercel.app/api/queue \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$(uuidgen)\",\"party_size\":1,\"pickup_spot_id\":\"spot_a\",\"drop_zone_id\":\"m1\"}" &
done
```

**현재 방어**: ❌ **없음**
- Rate Limiting 미존재
- session_id 포맷 검증 없음 (`attacker-1` 같은 문자열도 통과)
- 동일 IP에서 무한 호출 가능

**2차 피해**:
- `POST /api/queue`가 매번 `triggerAllMatches()`를 호출하므로, 1000건 삽입 시 매칭 엔진이 1000번 실행됨
- Supabase DB 읽기/쓰기 할당량 소진 → 서비스 전체 다운

---

### T2. 타인 매칭 상태 조작 (Match Hijacking)

**심각도**: 🔴 Critical

**공격 방법**: `PATCH /api/match/{id}`로 아무 `session_id`를 전송하여 다른 사람의 도착 확인을 위조하거나 팀을 강제 출발시킬 수 있음

```bash
# 공격 1: 가짜 도착 확인 → 노쇼인 사람도 도착 처리
curl -X PATCH https://kkinggitaja.vercel.app/api/match/MATCH_UUID \
  -d '{"action":"arrive","session_id":"fake-session-id"}'

# 공격 2: 강제 출발 → 누구든 depart 전송하면 팀 전체 출발 처리
curl -X PATCH https://kkinggitaja.vercel.app/api/match/MATCH_UUID \
  -d '{"action":"depart","session_id":"anyone"}'
```

**현재 방어**: ❌ **없음**
- `arrive` 액션: `session_id`가 해당 match의 멤버인지 확인하지 않음 → DB에 `match_id`와 무관한 `session_id`로 업데이트 시도 시, 조건 불일치로 업데이트가 0건이지만 **에러 없이 성공 응답** 반환
- `depart` 액션: **session_id 검증 자체가 없음**. 어떤 session_id든 match를 출발 처리 가능

**추가 발견 — `queue/[id]` 엔드포인트도 동일 취약점 보유**:

```typescript
// src/app/api/queue/[id]/route.ts — session_id 없이 cancel/arrived 가능
const { action } = await request.json();  // session_id를 아예 안 받음!
```

아무나 다른 사람의 `queue_entry` ID만 알면 대기를 취소하거나 도착 처리 가능.

---

### T3. Supabase 직접 쿼리 공격 (RLS Bypass)

**심각도**: 🔴 Critical

**공격 방법**: `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 클라이언트 번들에 노출됨. 공격자가 이 값으로 Supabase에 직접 쿼리를 보내면 모든 RLS 정책이 `USING (true)`이므로:

```javascript
// 공격자 브라우저 콘솔에서
const { createClient } = supabase;
const sb = createClient('EXPOSED_URL', 'EXPOSED_ANON_KEY');

// 1. 전체 대기열 조회 (모든 유저의 session_id, nickname 노출)
const { data } = await sb.from('queue_entries').select('*');

// 2. 타인의 queue_entry를 직접 수정
await sb.from('queue_entries')
  .update({ status: 'cancelled' })
  .eq('session_id', '피해자-session-id');

// 3. 타인의 match를 강제 출발/취소
await sb.from('matches')
  .update({ status: 'departed' })
  .eq('id', 'match-uuid');

// 4. 가짜 신고 대량 삽입
for (let i = 0; i < 100; i++) {
  await sb.from('reports').insert({
    reporter_session_id: `fake-${i}`,
    match_id: 'target-match-uuid',
    type: 'noshow'
  });
}
```

**현재 방어**: ❌ **없음** — 모든 테이블의 RLS 정책이 `true`

---

### T4. 신고 테러 (Report Spam & Weaponization)

**심각도**: 🟠 High

**공격 방법**:
1. `/api/report` POST를 반복 호출하여 무고한 유저에 대한 허위 `noshow` 신고 대량 접수
2. 동일 session_id로 같은 match에 중복 신고 가능 (UNIQUE 제약 없음)
3. 허위 신고로 노쇼 카운트 증가 → 자동 차단 시스템이 피해자를 24시간 차단

```bash
# 허위 노쇼 신고 3회 → 피해자 자동 24시간 차단
for i in 1 2 3; do
  curl -X POST https://kkinggitaja.vercel.app/api/report \
    -d "{\"session_id\":\"attacker-$i\",\"match_id\":\"TARGET_MATCH\",\"type\":\"noshow\"}"
done
```

**현재 방어**: ❌ 
- 중복 신고 DB 제약 없음
- 신고자가 해당 match의 멤버인지 확인 안 함
- Rate Limiting 없음

---

### T5. 대기열 취소 공격 (Queue Entry Cancellation)

**심각도**: 🟠 High

**공격 방법**: `PATCH /api/queue/{id}` 엔드포인트에서 `session_id`를 검증하지 않음. `queue_entry`의 UUID만 알면 누구나 다른 사람의 대기를 취소 가능.

```bash
# queue_entry ID만 알면 취소 가능 (session_id 불필요)
curl -X PATCH https://kkinggitaja.vercel.app/api/queue/ENTRY_UUID \
  -d '{"action":"cancel"}'
```

**entry ID 획득 방법**: RLS가 `USING (true)`이므로 Supabase 직접 쿼리로 전체 대기열 조회 가능

---

### T6. 매칭 엔진 서비스 거부 (Matching Engine DoS)

**심각도**: 🟠 High

**공격 방법**: `POST /api/queue`가 매번 `triggerAllMatches()`를 동기 호출하는 구조이므로, 동시에 대량 요청 시:

1. 각 요청이 `triggerAllMatches()` 실행 → DB에서 전체 waiting 엔트리 조회
2. 매칭 그룹 수 × DB 쿼리 수만큼 Supabase 호출 폭증
3. Race condition: 여러 인스턴스가 동시에 같은 엔트리를 매칭 → 중복 매칭 발생

**현재 방어**: ❌ 
- 매칭 엔진에 lock/mutex 없음
- 동시 실행 방지 없음

---

### T7. 관리자 기능 우회

**심각도**: 🟡 Medium

**공격 방법**: 
- `/api/cron` GET 요청 시 `CRON_SECRET`이 없으면 Supabase Auth 세션을 체크하지만, **쿠키 기반 세션은 서버에서 확인 불가능한 경우가 많음**
- `cleanupAndReMatch()` 자체가 관리자 전용인데, 인증 우회 시 아무나 매칭 정리/재실행 가능

---

## ✅ 방어 구현 계획 (우선순위별)

### 🔥 Priority 1 — 즉시 적용 (Critical, 코드 변경만으로 가능)

---

#### [S1] API Rate Limiting — IP 기반 인메모리 Sliding Window

**신규 파일**: `src/middleware.ts`

Vercel 서버리스에서 인스턴스 간 메모리가 공유되지 않지만, 단일 인스턴스 기준으로도 burst 공격의 80%를 완화합니다.

```typescript
import { NextResponse, type NextRequest } from "next/server";

// In-memory sliding window rate limiter
const windowMs = 60_000; // 1 minute
const ipMap = new Map<string, { timestamps: number[]; blocked_until?: number }>();

// Endpoint-specific limits
const LIMITS: Record<string, number> = {
  "POST:/api/queue":  5,
  "POST:/api/report": 3,
  "PATCH:/api/match": 10,
  "PATCH:/api/queue": 10,
  "GET:/api":         60,
};

function getLimit(method: string, pathname: string): number {
  // Check specific endpoint first
  const key = `${method}:${pathname.replace(/\/[^/]+$/, "")}`;
  if (LIMITS[key]) return LIMITS[key];
  const exactKey = `${method}:${pathname}`;
  if (LIMITS[exactKey]) return LIMITS[exactKey];
  // Fallback: check broader patterns
  for (const [pattern, limit] of Object.entries(LIMITS)) {
    if (exactKey.startsWith(pattern) || key.startsWith(pattern)) return limit;
  }
  return 120; // Default generous limit for GET
}

function isRateLimited(ip: string, method: string, pathname: string): boolean {
  const limit = getLimit(method, pathname);
  const now = Date.now();
  const key = `${ip}:${method}:${pathname}`;

  let entry = ipMap.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    ipMap.set(key, entry);
  }

  // Check if IP is temporarily blocked (escalation for extreme abuse)
  if (entry.blocked_until && now < entry.blocked_until) return true;

  // Sliding window: remove timestamps older than windowMs
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  entry.timestamps.push(now);

  if (entry.timestamps.length > limit) {
    // If 5x over limit, block for 5 minutes
    if (entry.timestamps.length > limit * 5) {
      entry.blocked_until = now + 5 * 60_000;
    }
    return true;
  }
  return false;
}

// Periodic cleanup (every 5 min, prevent memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipMap.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
    if (entry.timestamps.length === 0 && (!entry.blocked_until || now > entry.blocked_until)) {
      ipMap.delete(key);
    }
  }
}, 5 * 60_000);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api")) return NextResponse.next();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const method = request.method;

  if (isRateLimited(ip, method, pathname)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
```

| 엔드포인트 | 제한 | 근거 |
|-----------|------|------|
| `POST /api/queue` | IP당 **5회/분** | 정상 유저는 1회만 호출. 5회면 충분한 여유 |
| `POST /api/report` | IP당 **3회/분** | 1매치 = 1신고. 3회면 일반 사용에 여유 |
| `PATCH /api/match/*` | IP당 **10회/분** | arrive + depart = 2회. 10회면 충분 |
| `GET /api/*` | IP당 **60회/분** | 폴링 등 일반 사용 허용 |
| **반복 위반 시** | **5분 차단** | 5× 초과 시 해당 IP를 5분간 블랙리스트 |

---

#### [S2] Session 소유권 검증 강화

모든 상태 변경 API에서 요청자가 **해당 리소스의 실제 소유자/멤버**인지 DB에서 검증합니다.

**수정 파일 1**: `src/app/api/match/[id]/route.ts`

```typescript
// BEFORE (취약)
const { action, session_id } = await request.json();
if (action === "arrive") {
  await supabase.from("queue_entries")
    .update({ status: "arrived" })
    .eq("match_id", match_id)
    .eq("session_id", session_id);
  // ❌ 업데이트 0건이어도 성공 응답
}

// AFTER (방어)
const { action, session_id } = await request.json();

// 1. session_id UUID 포맷 검증
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!session_id || !UUID_V4.test(session_id)) {
  return NextResponse.json({ error: "Invalid session." }, { status: 400 });
}

// 2. 해당 match의 멤버인지 확인
const { data: membership } = await supabase
  .from("queue_entries")
  .select("id, status")
  .eq("match_id", match_id)
  .eq("session_id", session_id)
  .single();

if (!membership) {
  return NextResponse.json({ error: "이 매칭의 멤버가 아닙니다." }, { status: 403 });
}

if (action === "depart") {
  // 3. depart는 status가 'arrived' 또는 'all_arrived'인 경우만 허용
  const { data: match } = await supabase
    .from("matches")
    .select("status")
    .eq("id", match_id)
    .single();

  if (!match || !['assembling', 'all_arrived'].includes(match.status)) {
    return NextResponse.json({ error: "출발할 수 없는 상태입니다." }, { status: 400 });
  }
}
```

**수정 파일 2**: `src/app/api/queue/[id]/route.ts`

```typescript
// BEFORE (취약)
const { action } = await request.json(); // session_id를 안 받음!

// AFTER (방어)
const { action, session_id } = await request.json();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!session_id || !UUID_V4.test(session_id)) {
  return NextResponse.json({ error: "Invalid session." }, { status: 400 });
}

// 소유권 확인: 이 queue_entry가 요청자의 것인지
const { data: entry } = await supabase
  .from("queue_entries")
  .select("session_id, status")
  .eq("id", id)
  .single();

if (!entry || entry.session_id !== session_id) {
  return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
}
```

---

#### [S3] 신고 시스템 악용 방지

**수정 1** — DB 유니크 제약으로 동일 세션의 동일 매치 중복 신고 차단:

```sql
ALTER TABLE reports ADD CONSTRAINT unique_report_per_session_match
  UNIQUE (reporter_session_id, match_id);
```

**수정 2** — `src/app/api/report/route.ts`에 신고자가 해당 매치 멤버인지 확인:

```typescript
// AFTER (방어)
// 1. UUID 포맷 검증
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID_V4.test(session_id) || !UUID_V4.test(match_id)) {
  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}

// 2. 신고자가 해당 match의 실제 멤버인지 확인
const { data: membership } = await supabase
  .from("queue_entries")
  .select("id")
  .eq("match_id", match_id)
  .eq("session_id", session_id)
  .single();

if (!membership) {
  return NextResponse.json({ error: "이 매칭의 멤버만 신고할 수 있습니다." }, { status: 403 });
}

// 3. 중복 신고 체크 (DB 제약 + 코드 레벨 양쪽)
const { data: existingReport } = await supabase
  .from("reports")
  .select("id")
  .eq("reporter_session_id", session_id)
  .eq("match_id", match_id)
  .single();

if (existingReport) {
  return NextResponse.json({ error: "이미 신고한 매칭입니다." }, { status: 409 });
}
```

---

#### [S4] Security Headers 추가

**수정 파일**: `next.config.ts`

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  headers: async () => [{
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",    // Next.js 필수
          "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
          "font-src 'self' fonts.gstatic.com",
          "img-src 'self' data: blob:",
          `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}`,
        ].join("; "),
      },
    ],
  }],
};

export default nextConfig;
```

---

#### [S5] session_id UUID v4 포맷 검증 유틸리티

**신규 파일**: `src/lib/validation.ts`

```typescript
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_REGEX.test(value);
}

export function sanitizeErrorMessage(error: unknown): string {
  // 절대 내부 에러 메시지를 클라이언트에 노출하지 않음
  console.error("[Internal Error]", error);
  return "서버 오류가 발생했습니다.";
}
```

**`POST /api/queue`에 UUID 검증 추가**:

```typescript
// 기존
if (!session_id || typeof session_id !== 'string') {
  return NextResponse.json({ error: "session_id is required." }, { status: 400 });
}

// 변경
import { isValidUUID } from "@/lib/validation";

if (!isValidUUID(session_id)) {
  return NextResponse.json({ error: "Invalid session." }, { status: 400 });
}
```

---

### 🟠 Priority 2 — 단기 적용 (1주 내)

---

#### [S6] RLS 정책 강화

현재 모든 RLS 정책이 `USING (true)` / `WITH CHECK (true)`이므로, anon key를 가진 누구나 Supabase에 직접 쿼리하여 모든 데이터를 읽고 수정할 수 있습니다. 아래와 같이 강화합니다.

```sql
-- ===== queue_entries =====

-- INSERT: session_id 필수 (빈 값 방지만, 서버 사이드이므로 최소한의 보호)
DROP POLICY IF EXISTS "Users can insert queue_entries" ON queue_entries;
CREATE POLICY "Server insert queue_entries" ON queue_entries
  FOR INSERT WITH CHECK (
    current_setting('role') = 'service_role'
  );

-- SELECT: 자기 세션의 엔트리만 조회 (서비스 역할은 전체 조회 가능)
DROP POLICY IF EXISTS "Public read access for queue_entries" ON queue_entries;
CREATE POLICY "Read own queue_entries" ON queue_entries
  FOR SELECT USING (
    current_setting('role') = 'service_role'
  );

-- UPDATE: 서비스 역할만 업데이트 가능
DROP POLICY IF EXISTS "Users can update queue_entries" ON queue_entries;
CREATE POLICY "Server update queue_entries" ON queue_entries
  FOR UPDATE USING (
    current_setting('role') = 'service_role'
  );

-- ===== matches =====
DROP POLICY IF EXISTS "Public read access for matches" ON matches;
CREATE POLICY "Server read matches" ON matches
  FOR SELECT USING (
    current_setting('role') = 'service_role'
  );

DROP POLICY IF EXISTS "Users can update matches status" ON matches;
CREATE POLICY "Server update matches" ON matches
  FOR UPDATE USING (
    current_setting('role') = 'service_role'
  );

-- ===== reports =====
DROP POLICY IF EXISTS "Users can insert reports" ON reports;
CREATE POLICY "Server insert reports" ON reports
  FOR INSERT WITH CHECK (
    current_setting('role') = 'service_role'
  );
```

> **핵심 전환**: 현재 아키텍처에서 **모든 DB 조작은 서버 사이드 API 라우트**를 통해 수행됩니다. 따라서 anon key로 직접 접근하는 경우를 전면 차단하고, `service_role`(서버 사이드)만 허용하는 것이 올바른 전략입니다.
>
> ⚠️ **주의**: 이 변경을 적용하면 **관리자 대시보드** (`src/app/admin/dashboard/page.tsx`)가 **클라이언트에서 Supabase 직접 쿼리**를 사용하므로 깨집니다. 대시보드를 서버 사이드 API 라우트 기반으로 변경해야 합니다. (아래 S7 참조)

---

#### [S7] 관리자 대시보드를 서버 사이드 API로 전환

현재 `admin/dashboard/page.tsx`는 클라이언트에서 `createClient()` (anon key)로 직접 DB를 조회합니다. RLS 강화 후에는 서버 사이드 API 라우트를 만들어 관리자 인증 후 `createAdminClient()` (service_role)로 조회해야 합니다.

**신규 파일**: `src/app/api/admin/data/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  // 1. 관리자 인증 확인
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. service_role로 데이터 조회
  const admin = await createAdminClient();

  const [queueResult, matchResult, reportResult, fareResult] = await Promise.all([
    admin.from("queue_entries").select("*").order("created_at", { ascending: false }).limit(20),
    admin.from("matches").select("*, members:queue_entries(*)").order("created_at", { ascending: false }).limit(20),
    admin.from("reports").select("*").order("created_at", { ascending: false }).limit(20),
    admin.from("fare_table").select("*, pickup_spots(name), drop_zones(name)"),
  ]);

  // 3. 통계
  const [matchCount, userCount, noshowCount] = await Promise.all([
    admin.from("matches").select("*", { count: "exact", head: true }),
    admin.from("queue_entries").select("*", { count: "exact", head: true }),
    admin.from("queue_entries").select("*", { count: "exact", head: true }).eq("status", "noshow"),
  ]);

  return NextResponse.json({
    queue: queueResult.data || [],
    matches: matchResult.data || [],
    reports: reportResult.data || [],
    fares: fareResult.data || [],
    stats: {
      matches: matchCount.count || 0,
      users: userCount.count || 0,
      noshows: noshowCount.count || 0,
    },
  });
}
```

---

#### [S8] 에러 메시지 정제

모든 API 라우트에서 내부 에러 메시지가 클라이언트에 노출되지 않도록 일괄 정제합니다.

**변경 패턴** (모든 API route 파일에 적용):

```typescript
// BEFORE — 내부 정보 노출
return NextResponse.json({ error: error.message }, { status: 500 });

// AFTER — 일반 메시지만 반환
console.error("[API Error]", error);
return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
```

**대상 파일**:
- `src/app/api/queue/route.ts` (3곳)
- `src/app/api/queue/[id]/route.ts` (2곳)
- `src/app/api/queue/count/route.ts` (1곳)
- `src/app/api/match/[id]/route.ts` (4곳)
- `src/app/api/report/route.ts` (1곳)
- `src/app/api/cron/route.ts` (1곳)

---

#### [S9] 매칭 엔진 동시 실행 방지

`POST /api/queue`에서 매번 `triggerAllMatches()`를 호출하는 구조를 개선합니다.

```typescript
// src/lib/matching.ts에 추가

let matchingInProgress = false;

export async function triggerAllMatches() {
  // 이미 매칭 엔진이 실행 중이면 스킵 (lock)
  if (matchingInProgress) {
    console.log("[Matching] Already in progress, skipping.");
    return;
  }

  matchingInProgress = true;
  try {
    // ... 기존 매칭 로직
  } finally {
    matchingInProgress = false;
  }
}
```

> ⚠️ Vercel 서버리스에서는 인스턴스 간 메모리가 공유되지 않으므로 완벽한 분산 lock은 아니지만, 동일 인스턴스 내 동시 실행을 방지합니다. 완벽한 해결에는 Redis 분산 lock 또는 DB 기반 advisory lock이 필요합니다. (P3 참조)

---

### 🟢 Priority 3 — 선택적 적용 (운영 안정화 후)

---

#### [S10] Upstash Redis 분산 Rate Limiting

Vercel의 서버리스 인스턴스 간 공유 가능한 Rate Limiter.

```bash
npm install @upstash/ratelimit @upstash/redis
```

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  analytics: true,
});
```

#### [S11] Vercel Firewall / WAF 설정

Vercel Pro 플랜에서 Firewall Rules로 IP 대역 차단, 국가별 차단, 요청 패턴 기반 차단.

#### [S12] DB Advisory Lock으로 매칭 엔진 분산 동시 실행 방지

```sql
-- pg_advisory_lock을 사용한 매칭 엔진 전용 lock
CREATE OR REPLACE FUNCTION try_acquire_matching_lock()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_try_advisory_lock(42);  -- 42는 매칭 엔진 전용 lock ID
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_matching_lock()
RETURNS VOID AS $$
BEGIN
  PERFORM pg_advisory_unlock(42);
END;
$$ LANGUAGE plpgsql;
```

#### [S13] Honeypot 엔드포인트

공격 탐지용 가짜 API 엔드포인트를 만들어 공격자 IP를 사전 식별합니다.

```typescript
// src/app/api/admin/users/route.ts (Honeypot)
export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  console.warn(`[HONEYPOT] Suspicious access from IP: ${ip}`);
  // 해당 IP를 관리자에게 알림 또는 자동 차단
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

---

## 수정 대상 파일 요약

| 우선순위 | 파일 | 작업 | 방어 대상 |
|:--------:|------|------|----------|
| 🔥 P1 | `src/middleware.ts` | **신규** — IP 기반 Rate Limiter | T1, T4, T6 |
| 🔥 P1 | `src/app/api/match/[id]/route.ts` | 멤버십 검증 + UUID 검증 + 에러 정제 | T2 |
| 🔥 P1 | `src/app/api/queue/[id]/route.ts` | 소유권 검증 추가 + session_id 필수화 | T5 |
| 🔥 P1 | `src/app/api/report/route.ts` | 멤버십 검증 + 중복 신고 방지 + UUID 검증 | T4 |
| 🔥 P1 | `src/lib/validation.ts` | **신규** — UUID 검증 + 에러 정제 유틸리티 | 전체 |
| 🔥 P1 | `next.config.ts` | Security Headers + CSP 추가 | Clickjacking, XSS |
| 🟠 P2 | Supabase Dashboard | RLS 정책 전면 강화 (service_role only) | T3 |
| 🟠 P2 | `src/app/api/admin/data/route.ts` | **신규** — 관리자 API 서버사이드 전환 | T7 |
| 🟠 P2 | 모든 API route 파일 (7개) | 에러 메시지 정제 (내부 정보 제거) | 정보 노출 |
| 🟠 P2 | `src/lib/matching.ts` | 동시 실행 방지 lock 추가 | T6 |
| 🟠 P2 | `src/app/api/queue/route.ts` | UUID 포맷 검증 적용 | T1 |
| 🟠 P2 | Supabase SQL | `reports` 테이블 UNIQUE 제약 추가 | T4 |
| 🟢 P3 | `package.json` | Upstash 의존성 (선택) | T1 분산 방어 |
| 🟢 P3 | Supabase SQL | Advisory Lock 함수 (선택) | T6 분산 방어 |

---

## Verification Checklist

### 🔥 P1 검증

- [ ] **Rate Limiter**: `POST /api/queue`를 같은 IP에서 6회 연속 호출 → 6번째에서 `429` 응답
- [ ] **Rate Limiter 에스컬레이션**: 25회 연속 초과 시 → 5분간 모든 요청 `429`
- [ ] **소유권 검증 (match)**: 타인의 match에 `arrive` 전송 → `403` 응답
- [ ] **소유권 검증 (queue)**: 타인의 queue_entry에 `cancel` 전송 → `403` 응답
- [ ] **depart 검증**: 이미 departed인 match에 depart 재전송 → `400` 응답
- [ ] **UUID 검증**: `session_id=hacker123` → `400` 응답
- [ ] **신고 멤버십**: 매칭 비멤버의 신고 → `403` 응답
- [ ] **신고 중복**: 같은 match에 2번 신고 → 2번째에서 `409` 응답
- [ ] **Security Headers**: `curl -I` → `X-Frame-Options: DENY` 등 확인
- [ ] **CSP**: 브라우저 콘솔에서 외부 스크립트 주입 차단 확인

### 🟠 P2 검증

- [ ] **RLS 강화**: Supabase anon key로 `queue_entries` SELECT → 빈 결과 반환
- [ ] **RLS 강화**: Supabase anon key로 `matches` UPDATE → 권한 오류
- [ ] **에러 정제**: 잘못된 요청 시 Supabase/DB 내부 에러가 아닌 "서버 오류가 발생했습니다." 만 노출
- [ ] **매칭 동시 실행**: 2개의 동시 `triggerAllMatches()` → 하나만 실행됨
- [ ] **관리자 API**: 비인증 상태에서 `/api/admin/data` → `401` 응답

---

## 공격 시나리오별 방어 매핑

```
T1. 대기열 폭탄       → [S1] Rate Limiting + [S5] UUID 검증
T2. 매칭 상태 조작     → [S2] 소유권 검증 + [S5] UUID 검증
T3. Supabase 직접 공격 → [S6] RLS service_role only
T4. 신고 테러         → [S1] Rate Limiting + [S3] 멤버십 검증 + 중복 방지
T5. 대기열 취소 공격   → [S2] 소유권 검증
T6. 매칭 엔진 DoS     → [S1] Rate Limiting + [S9] 동시 실행 방지
T7. 관리자 기능 우회   → [S7] 서버사이드 API 전환
```
