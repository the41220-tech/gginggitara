# KKingGiTaJa — Development Plan

> **Service**: KKingGiTaJa (낑기타자) — A no-login, QR/link-based taxi ride-sharing PWA for Pusan National University  
> **Pilot Duration**: 2 weeks  
> **Reference**: [functional_spec_v1.md](file:///Users/gamgyeongmin/Desktop/MYH/GGinggitara/functional_spec_v1.md)

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 14 (App Router) | SSR + API Routes + PWA support |
| Styling | Vanilla CSS + CSS Variables | Minimal bundle, maximum flexibility |
| Backend / DB | Supabase (PostgreSQL) | Free tier, Realtime, Auth included |
| Realtime | Supabase Realtime | Listen to DB changes for matching & assembly |
| Admin Auth | Supabase Auth (email) | Single admin login |
| Deployment | Vercel | Optimal for Next.js, free tier |
| Theme | Light mode (default) | Outdoor readability |

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `pickup_spots` | 2 pickup locations (Spot A, Spot B) |
| `drop_zones` | 4 drop-off zones (Biology, Construction, Music, Law) |
| `fare_table` | Fare range & ride time per spot→zone combination |
| `queue_entries` | User queue with status, party size, session tracking |
| `matches` | Matched teams with team number, assembly deadline |
| `reports` | User reports (no-show, wrong count, bad behavior) |
| `blocked_sessions` | Blacklisted sessions with expiry |

### Key Schema Details

**`queue_entries.status`** enum:
`waiting` → `matched` → `arrived` → `departed` | `noshow` | `expired` | `cancelled`

**`matches.status`** enum:
`assembling` → `all_arrived` → `departed` | `cancelled`

**`matches.team_number`**: Daily auto-increment starting from 1 (resets at midnight)

---

## Development Phases

### Phase 1: Project Initialization (Day 1) — [리뷰 및 수정 완료]

#### 1.1 Scaffold Next.js Project
```bash
npx -y create-next-app@latest ./ --ts --app --eslint --no-tailwind --src-dir --import-alias "@/*"
```

#### 1.2 Supabase Setup
- Create Supabase project
- Run SQL migration for all 7 tables
- Configure Row Level Security (RLS)
- Set environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

#### 1.3 Design System (`/src/styles/globals.css`)
- CSS variables: colors, typography, spacing
- Light mode palette (white/slate backgrounds)
- Spot colors: Spot A `#2563EB`, Spot B `#16A34A`
- Font: `Noto Sans KR` via Google Fonts
- Mobile-first: max-width `480px`, touch targets ≥ `48px`

#### 1.4 PWA Configuration
- `manifest.json` (name: "낑기타자", display: standalone)
- Service worker for offline fallback page
- App icons (192px, 512px) — AI-generated logo

**Deliverables**: Running dev server, populated DB, design tokens, PWA manifest

---

### Phase 2: Core Backend — APIs (Days 2–3) — [리뷰 및 수정 완료]

#### 2.1 Session & Nickname Generation
- **`POST /api/session`** — Create/restore session (UUID v4 via client, validate on server)
- Nickname generator: `adjective + noun` (Korean), auto-assigned, immutable
- Session duplicate prevention: 1 active `waiting` entry per `session_id`

#### 2.2 Queue API
- **`POST /api/queue`** — Enter queue
  - Body: `{ session_id, party_size, pickup_spot_id, drop_zone_id }`
  - Validates: no-show cooldown, active session limit, spot/zone existence
  - Returns: `queue_entry` with generated nickname
- **`GET /api/queue/status?session_id={id}`** — Current entry status
- **`PATCH /api/queue/{id}/cancel`** — Cancel queue entry
- **`PATCH /api/queue/{id}/arrived`** — Mark as arrived at spot
- Rate limiting: max 3 queue entries per 5 minutes per session

#### 2.3 Matching Engine API
- **`POST /api/match/trigger`** — Execute matching logic (called on queue entry + 5s cron)
- Matching algorithm:
  1. Group `waiting` entries by `(pickup_spot_id, drop_zone_id)`
  2. Within each group, pair entries where `sum(party_size) ≤ 4`
  3. Prefer immediate matches; after 2 min, recommend departure with current count
  4. 5 min timeout → expire entry
- **Team number assignment**: Daily sequential integer, reset at midnight
- Concurrency control: Supabase transaction to prevent double-matching

#### 2.4 Match Lifecycle API
- **`GET /api/match/{id}`** — Match details (team number, members, arrival status)
- **`PATCH /api/match/{id}/arrive`** — Team member arrival confirmation
- **`PATCH /api/match/{id}/depart`** — Any 1 member triggers team departure
- **Assembly timeout handler** (Vercel Cron or Supabase pg_cron, every 30s):
  - If 2 min elapsed and not all arrived → remove no-shows → attempt re-match for remaining

#### 2.5 Fare Estimation API
- **`GET /api/fare?spot={id}&zone={id}&party_size={n}`**
- Returns: `{ fare_min, fare_max, per_person_min, per_person_max, ride_minutes, eta }`
- Narrow range, rounded up to nearest ₩100

#### 2.6 Report API
- **`POST /api/report`** — Submit report (no-show, wrong count, bad behavior, other)

#### 2.7 No-Show Penalty Logic
- Track `noshow_count` per session
- 1st: warning text only
- 2nd: 5-min cooldown (reject queue entry)
- 3rd: 30-min block (add to `blocked_sessions`)

**Deliverables**: All API routes tested, matching engine verified with unit tests

---

### Phase 3: Frontend — User Flow (Days 4–6) — [리뷰 및 수정 완료]

#### 3.1 `/join` — Entry + Selection Flow (Single Page, Multi-Step)

**Step 1: Party Size** (default: 1)
- 3 large buttons: `1명`, `2명`, `3명`
- `1명` pre-selected

**Step 2: Pickup Spot**
- 2 large buttons with color + location description
- 🔵 Spot A — Exit 3, across from designated spot
- 🟢 Spot B — Exit 1, across from Avenducci

**Step 3: Drop Zone**
- 4 buttons grouped: Mid (생물관, 건설관) / Upper (음악관, 법학관)

**Step 4: Fare Preview + Confirm**
- Display: estimated total fare, per-person fare, ride time, ETA
- Auto-generated nickname shown (read-only)
- `[매칭 시작]` (Start Matching) button

#### 3.2 `/waiting/{entry_id}` — Matching Wait Screen
- Loading animation (spinner/pulse)
- Current queue info: spot, zone, party size
- Count of others waiting for same spot+zone
- `[취소]` (Cancel) button
- Auto-redirect on match found (Supabase Realtime subscription on `queue_entries`)
- 5-min auto-expire

#### 3.3 `/team/{match_id}` — Team Screen (Match → Arrival → Departure)

**State: Assembling**
- Large **team number** display (e.g., `#42`)
- Team member list with nicknames + party sizes
- Spot name + color badge + location description
- Per-person fare (finalized)
- 2-min countdown timer
- `[위치에 도착했어요]` (I've Arrived) button
- Real-time arrival status: `✅ arrived` / `⏳ waiting`

**State: All Arrived**
- `"전원 도착! 택시를 직접 잡아서 출발하세요 🚕"`
- `[출발 완료]` (Departure Complete) button — any 1 member can trigger
- Report button

**State: Departed**
- `"출발 완료! 안전한 이동 되세요. 🚕"`

#### 3.4 `/result` — Result Screen
- Success: completion message
- Failure: "No matching riders found" + solo taxi info + restart button

#### 3.5 Realtime Subscriptions
- Subscribe to `queue_entries` changes (status → `matched`)
- Subscribe to `matches` changes (member arrivals, status transitions)
- Use Supabase Realtime `postgres_changes` channel

**Deliverables**: Complete user flow from QR entry to departure, all screens responsive

---

### Phase 4: Matching Engine Integration & Realtime (Days 7–8) — [리뷰 및 수정 완료]

#### 4.1 Server-Side Matching Execution
- Matching runs in Next.js API Route (or Supabase Edge Function)
- Triggered by: new queue entry creation + 5s polling interval
- Transaction-safe: SELECT FOR UPDATE to prevent race conditions

#### 4.2 No-Show Removal & Re-Matching
- Vercel Cron job (every 30s) or Supabase pg_cron:
  - Find matches past `assembly_deadline` with non-arrived members
  - Remove non-arrived entries (status → `noshow`, increment `noshow_count`)
  - Re-match arrived members with current `waiting` entries
  - If re-match succeeds → new team number, new 2-min countdown
  - If re-match fails → return arrived members to `waiting` status

#### 4.3 Timeout Handlers
| Condition | Action |
|-----------|--------|
| `waiting` > 5 min | Set status → `expired`, notify client |
| `matched` > 2 min without arrival | Remove no-shows, re-match remaining |
| All members arrived | Set match status → `all_arrived` |
| Any 1 member clicks depart | Set match status → `departed` |

#### 4.4 Daily Team Number Reset
- Vercel Cron at midnight KST: reset team number sequence to 1
- Or use `DATE(created_at)` partitioning in team number query

**Deliverables**: End-to-end matching flow, no-show handling, timeout processing

---

### Phase 5: Admin Dashboard (Days 9–10) — [리뷰 및 수정 완료]

#### 5.1 `/admin` — Login
- Supabase Auth email login
- Single admin user
- Redirect to dashboard on success

#### 5.2 Dashboard Views

**Real-time Queue Monitor**
- Queue entries grouped by spot → zone
- Waiting count, matched count, active teams
- Auto-refresh via Supabase Realtime

**Entry Management**
- Delete spam/fake entries
- Block sessions (add to `blocked_sessions`)

**Match Control**
- Force-create match from selected entries
- Cancel/dissolve existing match
- View team member details

**Spot Management**
- Toggle spot active/inactive

**Fare Table Editor**
- Edit fare_min, fare_max, ride_minutes per spot→zone

**Report Inbox**
- List all reports with type, description, timestamp
- Link to related match details

**Statistics Dashboard**
- Today: match count, departure rate, no-show rate
- Hourly demand chart (bar chart)
- Per-spot breakdown
- Cumulative trend graph (line chart over pilot period)
- CSV export of all matches/entries

#### 5.3 Mobile Responsive Admin
- Admin must work on mobile (field use)
- Simple table/card layouts, large touch targets

**Deliverables**: Fully functional admin panel with stats, entry/match/spot/fare management

---

## File Structure

```
src/
├── app/
│   ├── join/
│   │   └── page.tsx            # Multi-step entry flow
│   ├── waiting/
│   │   └── [entryId]/
│   │       └── page.tsx        # Matching wait screen
│   ├── team/
│   │   └── [matchId]/
│   │       └── page.tsx        # Team assembly & departure
│   ├── result/
│   │   └── page.tsx            # Success/failure result
│   ├── admin/
│   │   ├── page.tsx            # Admin login
│   │   └── dashboard/
│   │       └── page.tsx        # Admin dashboard
│   ├── api/
│   │   ├── queue/
│   │   │   └── route.ts        # Queue CRUD
│   │   ├── match/
│   │   │   ├── route.ts        # Match CRUD
│   │   │   └── trigger/
│   │   │       └── route.ts    # Matching engine trigger
│   │   ├── fare/
│   │   │   └── route.ts        # Fare estimation
│   │   ├── report/
│   │   │   └── route.ts        # Report submission
│   │   ├── admin/
│   │   │   └── route.ts        # Admin operations
│   │   └── cron/
│   │       └── route.ts        # Timeout & cleanup handler
│   ├── layout.tsx
│   └── page.tsx                # Redirect to /join
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   └── server.ts           # Server Supabase client
│   ├── matching.ts             # Matching algorithm
│   ├── fare.ts                 # Fare calculation logic
│   ├── nickname.ts             # Nickname generator
│   ├── session.ts              # Session management
│   └── types.ts                # TypeScript interfaces
├── components/
│   ├── StepSelector.tsx        # Reusable step button group
│   ├── SpotCard.tsx            # Pickup spot selection card
│   ├── ZoneButton.tsx          # Drop zone button
│   ├── FarePreview.tsx         # Fare/time estimation display
│   ├── TeamCard.tsx            # Team info (number, members)
│   ├── ArrivalStatus.tsx       # Real-time arrival checklist
│   ├── CountdownTimer.tsx      # 2-min assembly countdown
│   ├── LoadingSpinner.tsx      # Matching wait animation
│   └── AdminStats.tsx          # Statistics charts
├── styles/
│   └── globals.css             # Design system + all styles
└── public/
    ├── manifest.json           # PWA manifest
    ├── sw.js                   # Service worker
    ├── icon-192.png            # PWA icon
    └── icon-512.png            # PWA icon
```

---

## Testing Plan

### Unit Tests
```bash
npx jest --testPathPattern=matching   # Matching engine combinations
npx jest --testPathPattern=fare       # Fare calculation accuracy
npx jest --testPathPattern=nickname   # Nickname generation
npx jest --testPathPattern=session    # Session management
```

| Test Case | Expected |
|-----------|----------|
| 1+1 same spot+zone | Match created, team number assigned |
| 1+2 same spot+zone | Match created, party_size = 3 |
| 2+2 same spot+zone | Match created, party_size = 4 |
| Different zones | No match |
| Different spots | No match |
| 5-min timeout | Entry expired |
| 2-min assembly timeout | No-shows removed, re-match attempted |
| No-show 3x | Session blocked for 30 min |
| Duplicate session entry | Rejected |
| Single departure click | Entire team marked departed |

### Browser / E2E Tests
1. Open `/join` → complete all steps → reach waiting screen in < 15s
2. Two browser tabs → same spot+zone → match created with team number
3. Both arrive → departure → completion screen
4. One fails to arrive → removed after 2 min → remaining re-matched
5. Admin login → view queue → delete entry → verify removal

---

## Schedule Summary

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| 1. Init | Day 1 | Project + DB + design system + PWA |
| 2. Backend | Days 2–3 | All APIs + matching engine + no-show logic |
| 3. Frontend | Days 4–6 | All user-facing screens + realtime |
| 4. Integration | Days 7–8 | Matching + re-matching + timeouts |
| 5. Admin | Days 9–10 | Admin dashboard + stats + CSV |
| **Total** | **~10 days** | |

---

## Deployment Checklist

- [x] Supabase project created, tables migrated, RLS configured
- [x] Environment variables set on Vercel
- [ ] Custom domain configured (optional)
- [x] PWA icons generated from AI logo
- [ ] QR code generated pointing to `/join`
- [ ] QR poster designed (A4, laminated, waterproof)
- [ ] Admin account created in Supabase Auth
- [ ] Fare table populated with real taxi fare data
- [ ] Vercel Cron configured for timeout cleanup
- [ ] Community link prepared for distribution
