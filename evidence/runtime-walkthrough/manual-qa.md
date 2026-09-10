# Manual QA: runtime UX walkthrough

Run date: 2026-09-08 (Asia/Seoul)

## Environment

- Surface: Brave Browser via CUA, local Next.js app.
- Start command: `npm run dev -- --hostname 127.0.0.1`
- Base URL: `http://127.0.0.1:3000`
- Server evidence: Next.js 16.2.1, Turbopack, ready on `127.0.0.1:3000`.
- Source was not edited. No state-changing API/UI action was submitted.
- CUA screenshots were captured for each scenario during the walkthrough; this browser backend exposes them in the action trace but does not provide a filesystem screenshot-export API. The artifact below records the exact screenshot invocations and visible state.

## surfaceEvidence

| Scenario | Criterion | Surface | Exact invocation | Verdict | Artifact refs |
| --- | --- | --- | --- | --- | --- |
| S1 | Primary join setup renders and is usable | Brave, desktop viewport 1440x900 | `vcap.set({width:1440,height:900}); tab.reload(); tab.getAXState(); tab.screenshot({fullPage:true})` at `http://127.0.0.1:3000/join` | PASS | A1, A2 |
| S2 | Primary join setup renders and is usable on mobile | Brave, mobile viewport 390x844 | `vcap.set({width:390,height:844}); tab.goto('http://127.0.0.1:3000/join'); tab.getAXState(); tab.screenshot({fullPage:true})` | PASS | A1, A3 |
| S3 | Setup-to-room-list flow shows destination choices or a truthful room state | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/join'); vcap.set({width:390,height:844}); tab.playwright.getByRole('button',{name:'대기자 보기 →'}).click(); wait 900ms; tab.getAXState({disableDiffing:true}); tab.screenshot({fullPage:true})` | FAIL | A1, A4, A10 |
| S4 | Result route handles no active session without crashing | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/result'); wait 800ms; tab.getAXStateAndScreenshot({disableDiffing:true})` | FAIL | A1, A5 |
| S5 | Invalid waiting entry returns user to join | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/waiting/not-a-real-entry'); wait 1100ms; tab.getAXStateAndScreenshot({disableDiffing:true})` | PASS | A1, A6 |
| S6 | Admin login surface is reachable | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/admin'); wait 500ms; tab.getAXStateAndScreenshot({disableDiffing:true})` | PASS | A1, A7 |
| S7 | Unauthenticated dashboard redirects to admin login | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/admin/dashboard'); wait 1200ms; tab.getAXStateAndScreenshot({disableDiffing:true})` | PASS | A1, A8 |
| S8 | Invalid team route reports a terminal state | Brave, mobile viewport 390x844 | `tab.goto('http://127.0.0.1:3000/team/not-a-real-match'); wait 5.5s; tab.getAXState({disableDiffing:true})` | FAIL | A1, A9 |
| S13 | Rooms endpoint returns a successful payload for the room-list flow | HTTP API via terminal | `curl -i --max-time 10 http://127.0.0.1:3000/api/queue/rooms?spot=spot_a` | FAIL | A1, A10 |
| S14 | Queue count endpoint returns a successful payload | HTTP API via terminal | `curl -i --max-time 10 'http://127.0.0.1:3000/api/queue/count?spot=spot_a&zone=m1'` | FAIL | A1, A11 |
| S15 | Fare endpoint returns a successful payload | HTTP API via terminal | `curl -i --max-time 10 'http://127.0.0.1:3000/api/fare?spot=spot_a&zone=m1&party_size=1'` | PASS | A1, A12 |

## adversarialCases

| Scenario | Criterion | Adversarial class | Expected behavior | Verdict | Artifact refs |
| --- | --- | --- | --- | --- | --- |
| S9 | No active user session | empty/anonymous state | Result route should explain there is no active queue entry and provide a clear path to join | FAIL | A1, A5 |
| S10 | Unknown waiting entry id | invalid identifier | User should not see a blank/error page; redirect to join is acceptable | PASS | A1, A6 |
| S11 | Unknown match id | invalid identifier | User should see a not-found/expired-match state or be returned to a safe route within a short timeout | FAIL | A1, A9 |
| S12 | Protected admin area without auth | unauthorized access | Dashboard should not reveal data and should redirect to login | PASS | A1, A8 |
| S16 | Room-list API failure | server error response | UI should surface an error or retry state rather than presenting a misleading empty list | FAIL | A1, A4, A10 |

## Observations

1. `/join` desktop is centered in a narrow card-like column with a clear step 1 hierarchy: party size, departure mode, fixed pickup spot, then the main CTA. At 1440x900 the CTA and all controls are visible without scrolling.
2. `/join` mobile is readable at 390x844. The 2-column departure-mode cards fit without horizontal overflow, and the fixed pickup spot plus CTA remain visible at the bottom of the viewport.
3. Clicking `대기자 보기 →` with the local backend currently failing yields only the summary/empty copy: `아직 대기자가 없어요. 첫 번째가 되어보세요!` and a 3-minute expiry note. No destination `RoomCard` or direction buttons render. The browser capture showed no console error because the client silently ignores the failed rooms fetch. Exact HTTP evidence: `GET /api/queue/rooms?spot=spot_a` returned `HTTP/1.1 500 Internal Server Error` with `{"error":"서버 오류가 발생했습니다."}`.
4. `/result` with no active session remains on `상태를 확인하고 있습니다.` with a spinner-like loading treatment after the request settles. The CTA says `처음으로 돌아가기`; it does not explicitly explain that there is no active queue entry.
5. `/team/not-a-real-match` remains indefinitely on `주변 대기자를 검색 중...` after at least 5.5 seconds. No recovery CTA or not-found state appears.
6. `/admin/dashboard` redirects to `/admin` when unauthenticated. No admin credentials were entered and no login or external mutation was attempted.
7. Browser dev logs for the observed routes contained no `error` or `warning` entries in the captured checks.
8. Exact read-only API checks: `GET /api/queue/count?spot=spot_a&zone=m1` returned `HTTP/1.1 500 Internal Server Error` with `{"error":"서버 오류가 발생했습니다."}`; `GET /api/fare?spot=spot_a&zone=m1&party_size=1` returned `HTTP/1.1 200 OK` with fare/bus-estimate JSON.

## artifactRefs

| ID | Kind | Description | Path |
| --- | --- | --- | --- |
| A1 | report | This manual QA matrix and observation record | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A2 | screenshot-trace | Desktop `/join` screenshot captured by `tab.screenshot({fullPage:true})` at 1440x900; visible in CUA trace | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A3 | screenshot-trace | Mobile `/join` screenshot captured by `tab.screenshot({fullPage:true})` at 390x844; visible in CUA trace | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A4 | screenshot-trace | Mobile empty room-list screenshot after clicking `대기자 보기 →`; visible in CUA trace | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A5 | state-capture | `/result` AX snapshot after 800ms, still loading/no-session state | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A6 | state-capture | Invalid waiting route AX snapshot after redirect to `/join` | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A7 | screenshot-trace | Admin login screenshot and AX snapshot | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A8 | state-capture | Dashboard URL and login AX snapshot after unauthenticated redirect | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A9 | state-capture | Invalid team route AX snapshot after 5.5s, indefinite spinner | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A10 | http-and-ui-capture | `curl -i --max-time 10 http://127.0.0.1:3000/api/queue/rooms?spot=spot_a` returned HTTP 500; corrected mobile S3 screenshot/AX state showed only summary/empty copy and no destination cards/buttons | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A11 | http-capture | `curl -i --max-time 10 'http://127.0.0.1:3000/api/queue/count?spot=spot_a&zone=m1'` returned HTTP 500 with `{"error":"서버 오류가 발생했습니다."}` | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
| A12 | http-capture | `curl -i --max-time 10 'http://127.0.0.1:3000/api/fare?spot=spot_a&zone=m1&party_size=1'` returned HTTP 200 with fare and bus-estimate JSON | `/Users/gamgyeongmin/Desktop/project/MYH/GGinggitara/evidence/runtime-walkthrough/manual-qa.md` |
