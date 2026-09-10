# Changelog

앱 버전은 `VERSION`과 `package.json`의 `version`을 같이 올립니다. Git 태그는 `vMAJOR.MINOR.PATCH`입니다.

## [0.1.1] - 2026-09-10

### Security
- 공개 Auth 가입을 로컬 설정에서 끄고, 관리자는 확인된 이메일 + 허용 목록만 통과하도록 강화
- Data API에서 대기열·매칭·신고 테이블을 deny-all RLS로 재잠금
- 관리자 변경 API에 same-origin 검사 추가 (`Host`와 `Origin` 비교, `127.0.0.1` 로컬 접속 유지)
- cron Bearer 비교를 timing-safe로 변경
- 관리자 데이터 API가 `session_id`를 내려주지 않도록 컬럼을 제한
- `/admin/dashboard`를 서버에서 인증하도록 변경

### Notes
- 호스팅된 Supabase 프로젝트의 공개 가입 스위치는 코드와 별개입니다. 대시보드에서 꺼야 합니다.
- 이 버전은 로컬 작업본입니다. Vercel 프로덕션에 반영하려면 이 태그로 배포해야 합니다.

## [0.1.0] - 2026-09-10

### Added
- 부산대역 Spot A 파일럿: QR/링크 진입, 대기·제안·집합·출발·정산, 운영자 대시보드
