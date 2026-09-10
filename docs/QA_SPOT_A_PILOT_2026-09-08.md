# Spot A 파일럿 배포 전 QA 보고서

검증일: 2026-09-08  
대상: 로컬 Supabase + Next.js 프로덕션 빌드 (`http://127.0.0.1:3107`)  
배포 범위: 준비 및 로컬 검증까지. 원격 스테이징·프로덕션 변경 없음.

## 판정

**PASS — 원격 환경변수·백업·스테이징 승인만 남은 배포 후보입니다.**

## DB와 카탈로그

- 신규 migration: `20260908083843_spot_a_only_pilot.sql`
- 현재 로컬 DB: `spot_a=true`, `spot_b=false`, 활성 승차 지점 수 `1`
- 전체 migration을 별도의 일회용 PostgreSQL 17 DB에 처음부터 재생: PASS
- 실제 `GET /api/catalog`: `spot_a` 하나만 반환

## 실제 매칭 검증

API E2E와 두 개의 독립 모바일 브라우저 세션을 각각 실행했습니다.

1. Spot A·생물관 경로로 1명씩 두 일행 등록
2. 빠른 출발 제안이 두 사용자에게 생성
3. 양측 수락 후 같은 팀으로 집합
4. 비멤버 매치 접근 거부
5. 양측 도착 후 출발 가능 전환
6. 한 명의 출발 확정으로 양측 출발 완료
7. 실제 요금·계좌 정산 저장과 팀원 조회
8. 신고 중복 제출 멱등 처리
9. 제안 만료 후 일시정지·재개·취소
10. 잘못된 인원 입력 거부

결과: 모든 단계 PASS. 테스트가 만든 엔트리와 매치는 정확한 ID만 정리했습니다.

## 모바일·화면 QA

- fixture 기반 상태 매트릭스: 35개 시나리오, 40개 캡처, 실패 0
- 실제 DB/Auth 기반 캡처: 고객 흐름 6개 + 관리자 대시보드 1개
- 폭: 320, 375, 768, 1280px
- 수평 오버플로: 0
- 실제 고객 흐름의 44px 미만 터치 대상: 수정 후 0
- 오퍼·출발 확인 모달 포커스 트랩, 닫은 뒤 포커스 복귀, reduced motion: PASS
- 예상 오류, 취소, 만료, 노쇼, 정산 미등록·등록·오류, 404: PASS
- 모든 PNG를 육안 검토해 잘림·겹침·한글 줄바꿈 이상 없음

발견 및 수정:

- 공용 상단 브랜드 링크의 터치 높이가 32px였습니다. `public-flow.module.css`에서 최소 높이를 48px로 높인 뒤 실제 흐름을 처음부터 다시 실행해 통과했습니다.
- 제목의 한국어 단어와 확인창 조사가 줄 중간에서 갈라지는 화면이 있었습니다. 공용 제목·대화상자에 한국어 어절 단위 줄바꿈을 적용한 뒤 47개 캡처 전체를 다시 생성해 문제 문구와 오버플로를 재검증했습니다.

## 증적

- 전체 캡처: `.omo/evidence/spot-a-pilot-qa/`
- 상태 매트릭스: `.omo/evidence/spot-a-pilot-qa/qa-summary.json`
- 실제 고객 흐름: `.omo/evidence/spot-a-pilot-qa/live-flow-summary.json`
- 실제 관리자 로그인: `.omo/evidence/spot-a-pilot-qa/live-admin-summary.json`
- 수동 QA 표: `.omo/evidence/spot-a-pilot-qa/manual-qa.md`

## 배포 전에 반드시 남은 일

1. 서비스 역할 키와 `CRON_SECRET`의 노출 이력을 확인하고 필요하면 교체합니다.
2. 프로덕션 전용 `PARTICIPANT_SESSION_SECRET`(32자 이상), `EVENT_HASH_SALT`, `ADMIN_EMAILS`를 설정합니다.
3. 관리형 DB 백업과 복구 담당자를 확인한 뒤 스테이징에서 migration dry-run 및 실제 적용을 반복합니다.
4. cron, 오류율, 매칭 대기, 실패 알림을 연결합니다.
5. 인스턴스 메모리 기반 rate limit은 전역 제한이 아니므로 공유 저장소를 붙이거나 운영 위험으로 승인합니다.
