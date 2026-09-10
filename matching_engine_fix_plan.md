# 매칭 엔진 로직 점검 및 개선 방안

> 2026-03-22 20:26 기준 프로덕션 테스트에서 발견된 두 가지 문제에 대한 근본 원인 분석 및 개선안입니다.

---

## 발견된 문제

| # | 증상 | 심각도 |
|---|------|--------|
| 1 | 실제 사용자 2명뿐인데 **이상한 유저**가 매칭에 잡힘 | 🔴 Critical |
| 2 | 같은 위치(같은 스팟 + 같은 존)인데 **매칭이 안 됨** | 🔴 Critical |

---

## 근본 원인 분석 (Root Cause)

### 🔴 RC-1: `matching` 상태로 영구 고착 (Phantom Users)

**파일**: `src/lib/matching.ts` L12-18

```typescript
// 매칭 시작 시 모든 waiting → matching 으로 변경
await supabase
  .from("queue_entries")
  .update({ status: 'matching' })
  .eq("pickup_spot_id", spot_id)
  .eq("status", "waiting");
```

**문제**: 매칭 로직이 실행되다가 **중간에 에러가 나거나 Vercel 서버리스 함수가 타임아웃**되면, `matching` 상태로 변경된 엔트리들이 **영영 `waiting`으로 돌아오지 못합니다**. 이 유령 엔트리들이 다음 매칭 시도 때 다시 잡힙니다.

→ 이것이 "이상한 놈이 잡히는" 원인.

### 🔴 RC-2: 중복 체크가 `waiting`만 확인

**파일**: `src/app/api/queue/route.ts` L38-49

```typescript
.eq("status", "waiting") // ← matching 상태는 체크 안 함!
```

**문제**: 유저가 매칭 버튼을 누르면 엔트리가 `waiting`으로 생성되고, 곧바로 `triggerAllMatches()`가 호출되어 `matching`으로 변경됩니다. 이때 같은 유저가 다시 매칭 버튼을 누르면 — `waiting` 상태인 엔트리가 없으니 **중복 체크를 통과**하여 **새 엔트리가 또 생성**됩니다. 이 중복 엔트리가 "이상한 유저"로 잡히는 추가 원인입니다.

### 🔴 RC-3: Cron Job 미설정 → `cleanupAndReMatch` 미실행

**파일**: `src/app/api/cron/route.ts`

Vercel에 Cron Job 스케줄이 설정되어 있지 않으면 `cleanupAndReMatch()`가 **단 한 번도 호출되지 않습니다**. 따라서:
- 5분 경과한 `waiting` 엔트리가 `expired` 처리되지 않음
- assembly deadline이 지난 매치가 정리되지 않음
- 과거의 잔여 데이터가 계속 매칭 풀(pool)에 잔류

### 🟡 RC-4: 매칭 트리거 타이밍 문제

**파일**: `src/lib/matching.ts` L59-73, `src/app/api/queue/route.ts` L76

```typescript
// queue/route.ts에서 엔트리 생성 후 즉시 triggerAllMatches() 호출
await triggerAllMatches();
```

유저 A가 대기열에 들어와서 `triggerAllMatches()`를 호출합니다. 이때 A는 혼자(`currentSum=1`)이므로 매칭되지 않아야 합니다. 그런데 이 호출이 A의 엔트리를 `matching`→`waiting`으로 왕복시키면서, 직후에 유저 B가 들어와서 `triggerAllMatches()`를 호출할 때 **A가 아직 `matching` 상태**에 머물러 있을 수 있습니다. 그러면 B의 트리거가 A를 `waiting`으로 볼 수 없어서 **매칭 실패**.

→ 이것이 "같은 위치인데 매칭이 안 되는" 핵심 원인.

---

## 개선 방안

### Fix 1: Optimistic Lock 제거 → 직접 `waiting` 상태에서 매칭

`matching` 중간 상태를 완전히 제거합니다. `waiting` 상태의 엔트리들을 직접 읽어 그룹을 구성하고, 매칭 확정 시에만 `matched`로 변경합니다.

```diff
- await supabase.update({ status: 'matching' }).eq("status", "waiting");
- // ... fetch matching entries ...
+ // 바로 waiting 상태에서 매칭 후보를 읽어옴
+ const { data: waiting } = await supabase
+   .from("queue_entries")
+   .select("*")
+   .eq("status", "waiting")
+   .order("created_at", { ascending: true });
```

### Fix 2: 중복 체크 범위 확대

`waiting` OR `matching` OR `matched` 상태 모두 체크:

```diff
- .eq("status", "waiting")
+ .in("status", ["waiting", "matching", "matched"])
```

### Fix 3: Vercel Cron Job 설정

`vercel.json`에 cron 스케줄 추가:

```json
{
  "crons": [{
    "path": "/api/cron",
    "schedule": "* * * * *"
  }]
}
```

### Fix 4: 30초 대기 로직 완화 (MVP 단계)

현재 2인 그룹도 30초를 기다려야 매칭되는데, **MVP 단계에서는 2인 이상이면 즉시 매칭**하도록 변경:

```diff
- if (currentGroup.length === 1 && waitMs < 30000) {
-   shouldMatch = false;
- } else {
-   shouldMatch = true;
- }
+ shouldMatch = true; // 2인 이상이면 즉시 매칭
```

---

## 수정 대상 파일 요약

| 파일 | 수정 내용 |
|------|----------|
| `src/lib/matching.ts` | `matching` 중간 상태 제거, waiting에서 바로 matched로 전환 |
| `src/app/api/queue/route.ts` | 중복 체크 범위를 waiting/matching/matched 모두 포함 |
| `vercel.json` | Cron job 추가 (1분 간격 cleanupAndReMatch 호출) |
| `src/app/api/cron/route.ts` | CRON_SECRET 헤더로 인증 (기존 유지) |

---

## Verification Plan

1. `npm run test:clear`로 잔여 데이터 초기화
2. 브라우저 탭 2개에서 **동일 스팟+존**으로 매칭 시도 → 즉시 매칭 확인
3. 혼자(1명)일 때 매칭이 시작되지 않는지 확인
4. Vercel 재배포 후 프로덕션에서 동일 시나리오 재검증
