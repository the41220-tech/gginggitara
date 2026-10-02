# Gginggitara (낑기타자)

An anonymous taxi-sharing web app for a bounded route network around Pusan National University Station. Riders choose a destination, party size, and departure preference, then move through waiting, offer acceptance, assembly, departure, and fare settlement. Operators manage the route catalog, fare ranges, queue, and matching state.

**Status:** application version `0.1.1`; local verification and pilot-preparation evidence are available. This repository is not proof of a completed public rider trial or production readiness. The listed deployment is [gginggitara-production.vercel.app](https://gginggitara-production.vercel.app); the documentation update does not attest that it runs the current source revision.

## The problem and the bounded approach

Riders taking the same station-to-campus route can share a taxi, but they must agree on who is riding, when to depart, and how to settle the fare. This project makes those coordination steps explicit instead of treating matching as a one-time pairing result. This is the product problem being addressed, not a claim that interviews or rider outcomes have validated demand.

The first pilot contract enables **Spot A only**. Destinations are managed rather than free text: an active pickup, active destination, and complete fare table must exist before a route appears. That limits coverage but gives every proposal a known route and fare snapshot. See the [product specification](docs/superpowers/specs/2026-09-08-gginggitara-production-redesign-design.md) and [operating contract](docs/OPERATIONS.md).

## Decisions that shape the implementation

| Decision | What it solves | What it costs or leaves open |
| --- | --- | --- |
| One route pool for `fast` and `cheap` | Allows compatible parties to meet without separating them into competing queues | Partial groups must respect the waiting policy |
| Keep each party intact; combine at least two entries and 2–4 people | Preserves companions and taxi capacity | Some party-size combinations cannot depart together |
| Select and transition matches in PostgreSQL under an advisory lock | Gives matching a single state authority under concurrent requests | Correctness depends on the SQL contract, not just UI behavior |
| Signed anonymous participant cookie | Avoids account creation while binding actions to a participant | Clearing the cookie loses that browser's participant identity |
| Managed fare range, then actual settlement | Separates a route estimate from the fare actually paid | An estimate is not a guaranteed final price |

### A worked matching example

The following is an **illustrative policy example**, not a recorded rider trial. All entries have the same pickup and destination; letters identify synthetic parties, not people.

| Waiting entries | Policy outcome |
| --- | --- |
| A: 1 person, `fast`; B: 1 person, `fast` | Eligible for an immediate two-person offer |
| A: 1 person, `cheap`; B: 1 person, `fast` | Wait until the oldest relevant three-minute deadline before a partial offer |
| A: 2 people; B: 2 people | Eligible for an immediate four-person offer, regardless of departure preference |
| A: 3 people; B: 2 people | Do not split either party or exceed four seats |

When several combinations are eligible, the engine prioritizes the oldest matchable entry, then the fullest team. Offers expire after **20 seconds**; an unanswered entry is paused and can be resumed or cancelled. The three-minute and 20-second thresholds are implemented policy values, **not demonstrated optimal waiting times**.

## Changes and lessons visible in the source

- **Search completeness versus cost.** The matching hardening replaces a first-20-row cutoff with bounded representatives of equivalent party-size/preference/deadline signatures. This keeps a compatible entry beyond the old boundary discoverable without enumerating the entire queue. The [migration](supabase/migrations/20260912000000_matching_candidate_fairness.sql) and [regression tests](src/lib/matching-policy.test.ts) expose that tradeoff.
- **Recover from stale membership.** A second browser tab can invalidate the first tab's match view. The [team-recovery tests](src/lib/team-recovery.test.ts) cover recovery through a read-only queue lookup rather than retaining an inaccessible team.
- **Do not invent precision.** Unverified hardcoded bus times and queue estimates were removed from the API and UI. Registered route fare ranges remain estimates; actual payment is recorded separately.
- **Local UI findings led to specific fixes.** The September QA report records increasing a 32px brand-link touch area to at least 48px and correcting Korean word wrapping, followed by new captures. These are documented local corrections, not proof of field adoption.

## Verification and its limits

Fresh-clone checks performed on **2026-10-02**, without a live database or production writes:

| Check | Result | Scope |
| --- | --- | --- |
| `npm run test` | 52 passed; 0 failed, 0 skipped | Unit and source-contract regressions, including matching policy, authorization helpers, recovery, and analytics redaction |
| `npm run lint` | Passed after installing dev dependencies | Static linting |
| `npx next typegen && npx tsc --noEmit` | Passed | Generated route types and TypeScript checking |
| `npm run build` | Passed | Production compilation; not runtime DB or deployment acceptance |

Run route type generation before standalone `tsc` on a fresh clone: generated `RouteContext` declarations are otherwise absent. The test script currently obtains `tsx` through `npx` if it is not installed, so first execution can require registry access.

The [September 8 local pilot-preparation QA report](docs/QA_SPOT_A_PILOT_2026-09-08.md) records an API/mobile-browser flow through settlement, 35 fixture scenarios, and 40 fixture captures with no reported failures. It also lists remaining staging, backup, and operational gates. Its ignored capture directory is not bundled here, and those browser/database checks were **not rerun** for this documentation update. It is not evidence of a customer pilot, reduced waiting times, or financial savings.

**Known release limitation:** the dependency audit on 2026-10-02 reported a critical advisory for the locked Next.js version ([GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)). This README-only revision does not update dependencies. Passing tests and a public repository do not establish that this issue is fixed. Resolve the affected dependency and rerun the release gates before claiming production readiness. The instance-local rate limiter also does not provide a global serverless abuse limit.

## The next validation question

**Proposed, not completed:** do the current partial-team waiting and offer-expiry rules support a usable station flow without splitting parties or starving older eligible entries?

The next staged evaluation should record acceptance/expiry rates and waiting-time distributions for explicit synthetic arrival scenarios, alongside the invariant checks for capacity, intact parties, membership authorization, and recovery. Only after staging approval should an authorized field pilot assess rider behavior. The repository does not yet establish sample size, outcome targets, or an optimal timing policy; those must be chosen before interpreting pilot results.

## Reproduce locally

Requires Node.js **20.9+**, npm, and the Supabase CLI/local container runtime. The app uses Next.js, React, TypeScript, Supabase Auth, and PostgreSQL.

```bash
git clone https://github.com/the41220-tech/gginggitara.git
cd gginggitara
npm ci --include=dev
supabase start
```

Create an ignored local environment file using the variable names described in the [operations guide](docs/OPERATIONS.md). Use **only your own local Supabase values**. Configure participant signing, event salt, and the administrator allowlist; provision your own local administrator through Studio. No working credentials or pre-created administrator are supplied by this repository. Resetting local Auth data requires reprovisioning that account.

```bash
npm run dev -- --hostname 127.0.0.1
```

- Rider entry: `http://127.0.0.1:3000/join`
- Administrator entry: `http://127.0.0.1:3000/admin`
- Local Supabase Studio: `http://127.0.0.1:54323`

```bash
npm run test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```

Do not put service-role, session-signing, cron, or salt values behind a `NEXT_PUBLIC_` prefix: those variables enter the browser bundle. The server-issued cookie is `HttpOnly`, `SameSite=Strict`, and seven days long; production also uses `Secure` and a `__Host-` name. Participant **session identity** is not accepted from URLs, request bodies, or browser storage; queue and match resource IDs still exist in application routes.

Administrators must satisfy both Supabase Auth and the server-side email allowlist. Authentication alone does not grant administration rights.

## Safe operational checks

```bash
# Defaults to a read-only check against localhost.
node scripts/load-test.mjs

# Explicitly creates a queue journey against the local target only.
node scripts/load-test.mjs --run-journey
```

For state-changing E2E, use the explicit local/staging target contract in the [release checklist](docs/GO_LIVE_CHECKLIST.md). Do not run mutation or cleanup tests against production. Publishing source does not run a release, rotate credentials, or apply database migrations.

## Evidence and further reading

- [Rider guide](docs/고객-이용안내서.md)
- [Operator guide](docs/운영자-기능-로직-설명서.md)
- [Design system](DESIGN.md)
- [Operations and environment contract](docs/OPERATIONS.md)
- [Release checklist](docs/GO_LIVE_CHECKLIST.md)
- [Local Spot A QA report](docs/QA_SPOT_A_PILOT_2026-09-08.md)
- [Product and implementation specification](docs/superpowers/specs/2026-09-08-gginggitara-production-redesign-design.md)
- [Changelog](CHANGELOG.md)

Runtime releases use `VERSION`, `package.json`, and `vMAJOR.MINOR.PATCH` tags. This documentation-only update does not bump the runtime version or assert that a CLI deployment is tied to a Git tag. Product decisions above describe the repository's documented design; they do not assign an unsupported individual-versus-team/AI contribution history.
