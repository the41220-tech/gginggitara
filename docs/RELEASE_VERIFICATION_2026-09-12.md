# Production release verification

## Deployment
- Production URL: https://gginggitara-production.vercel.app
- Deployment: dpl_HGP5vRTrE12LsPT39sMUeNkRzCuF
- Immutable URL: https://gginggitara-production-8c1neay0z-kam-elliots-projects.vercel.app
- Previous deployment: dpl_CSYVjavvNtz87UgfJJn7f1RPJx8E
- Vercel promotion succeeded; inspecting production URL resolved to the new READY deployment.
- Source uploaded from an isolated allowlisted directory (src/public/manifests/build config), without local secrets, QA archives, or unrelated untracked materials.

## Changes
- Matching signature candidate pruning replaces first-20-row truncation.
- Exact offer versions protect offered transitions.
- Read-only queue/match GET handlers; explicit countdown POST advances deadlines.
- Team GET 403/404/cancelled recovery reads current queue state, including externally resolved timeouts. Invalid/stale recovery responses do not retain actionable stale team data.
- Mobile CTA, active session recovery, decline confirmation and shared API parsing/routing.

## Verification
- Parent execution: 52/52 tests, ESLint, production build, git diff --check passed.
- npm audit and npm audit --omit=dev: zero reported vulnerabilities.
- Supabase linked project fsvugivldrhgzbejpmlb: applied 20260912000000_matching_candidate_fairness.sql; migration list read-back matches local versions; remote DB lint found no schema errors.
- CLI emitted a nonfatal pg-delta catalog-cache certificate-path warning after migration. Migration history and DB lint independently confirmed success.
- Earlier local DB boundary regression (20 three-person entries followed by one one-person entry) passed; local API E2E passed. These are not production synthetic-journey results.
- Production /join and /api/catalog: HTTP 200; HSTS and CSP present.
- Production unauthenticated /api/queue, /api/admin/data, /api/cron: HTTP 401 as expected.
- Real production mobile browser loaded Spot A and four drop-zone cards, fare data and CTA.
- Vercel cron configuration enabled for the new deployment, every minute.
- Post-deploy logs: 11 HTTP 200, one HTTP 202, three intentional HTTP 401; no HTTP 5xx in collected window. Cron included HTTP 200 (separate from intentional unauthenticated 401 probe).

## Boundaries
- Short observation window is not an availability guarantee. No production mutating E2E or production load test was run.
- In-memory rate limiting remains per-instance, not distributed protection.
- Functions currently run in iad1 while DB is in Seoul; regional alignment remains a latency improvement opportunity.
- Existing completed managed backup was observed; PITR is disabled and restoration was not exercised.
- No operating data was deleted and no git commit/push was made.
