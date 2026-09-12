import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadLocalWriteEnvironment, loadStagingWriteEnvironment } from "./environment.mjs";

const HELP = `Usage: node scripts/e2e-flow-test.mjs --confirm-staging-write
       node --env-file=.env.development.local scripts/e2e-flow-test.mjs --confirm-local-write

Required environment:
  TEST_TARGET_ENV=staging
  TEST_BASE_URL=https://<staging-app-host>
  TEST_STAGING_APP_HOST=<staging-app-host>
  SUPABASE_URL=https://<staging-project-host>
  TEST_STAGING_SUPABASE_HOST=<staging-project-host>
  SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>

For local runs set TEST_TARGET_ENV=local and TEST_BASE_URL to a loopback app URL.
This test mutates only an explicitly confirmed local or staging target. It never
defaults a target and removes only the entry and match IDs created by this run.`;
const REQUEST_TIMEOUT_MS = 15_000;
const userNames = ["alice", "bob", "carol", "dan", "stranger", "invalid"];
const jars = new Map(userNames.map((name) => [name, new Map()]));
const entries = new Set();
const matches = new Set();

class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessError";
  }
}

const idSchema = z.uuid();
const catalogSchema = z.looseObject({
  pickup_spots: z.array(z.looseObject({ id: z.string().min(1) })),
  drop_zones: z.array(z.looseObject({
    id: z.string().min(1),
    fare: z.looseObject({ fare_min: z.number().int().positive() }),
  })),
});
const queueSchema = z.looseObject({
  id: idSchema,
  status: z.string(),
  match_id: idSchema.nullable(),
  offer_version: z.number().int().nonnegative(),
});
const matchSchema = z.looseObject({ id: idSchema, status: z.string(), members: z.array(z.looseObject({ id: idSchema })) });

function assert(condition, message) {
  if (!condition) throw new HarnessError(message);
}

function storeCookies(user, response) {
  const jar = jars.get(user);
  if (!jar) throw new HarnessError(`Unknown cookie jar: ${user}`);
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter((value) => value !== null);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(user, method, path, body) {
  const jar = jars.get(user);
  if (!jar) throw new HarnessError(`Unknown cookie jar: ${user}`);
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await fetch(new URL(path, environment.baseUrl), {
    method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  storeCookies(user, response);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HarnessError(`${method} ${path} returned non-JSON (HTTP ${response.status}).`);
    }
  }
  return { status: response.status, ok: response.ok, data };
}

async function step(name, action) {
  await action();
  process.stdout.write(`PASS ${name}\n`);
}

async function catalogFor(user, pickupId) {
  const path = pickupId ? `/api/catalog?pickup_spot_id=${encodeURIComponent(pickupId)}` : "/api/catalog";
  const result = await request(user, "GET", path);
  assert(result.ok, `Catalog failed for ${user}: HTTP ${result.status}`);
  return catalogSchema.parse(result.data);
}

async function discoverRoute() {
  const base = await catalogFor("alice");
  for (const pickup of base.pickup_spots) {
    const catalog = await catalogFor("alice", pickup.id);
    for (const dropZone of catalog.drop_zones) {
      const count = await request("alice", "GET", `/api/queue/count?pickup_spot_id=${encodeURIComponent(pickup.id)}&drop_zone_id=${encodeURIComponent(dropZone.id)}`);
      if (count.ok && count.data?.people === 0) return { pickup, dropZone };
    }
  }
  throw new HarnessError("Staging has no active route with an empty waiting queue.");
}

async function join(user, route) {
  const result = await request(user, "POST", "/api/queue", {
    party_size: 1,
    pickup_spot_id: route.pickupId,
    drop_zone_id: route.dropZoneId,
    departure_mode: "fast",
  });
  assert(result.ok, `Queue join failed for ${user}: HTTP ${result.status}`);
  const entry = queueSchema.parse(result.data);
  entries.add(entry.id);
  if (entry.match_id) matches.add(entry.match_id);
  return entry;
}

async function queueFor(user) {
  const result = await request(user, "GET", "/api/queue");
  assert(result.ok, `Queue read failed for ${user}: HTTP ${result.status}`);
  const entry = queueSchema.parse(result.data);
  if (entry.match_id) matches.add(entry.match_id);
  return entry;
}

async function transitionQueue(user, entryId, action, offerVersion = null) {
  const result = await request(user, "PATCH", `/api/queue/${entryId}`, { action, offer_version: offerVersion });
  assert(result.ok, `${action} failed for ${user}: HTTP ${result.status}`);
  return result.data;
}

async function transitionMatch(user, matchId, action) {
  const result = await request(user, "PATCH", `/api/match/${matchId}`, { action });
  assert(result.ok, `${action} failed for ${user}: HTTP ${result.status}`);
  return result.data;
}

async function cleanup() {
  const matchIds = [...matches];
  const entryIds = [...entries];
  const operations = [
    matchIds.length ? supabase.from("reports").delete().in("match_id", matchIds) : null,
    matchIds.length ? supabase.from("settlements").delete().in("match_id", matchIds) : null,
    entryIds.length ? supabase.from("queue_entries").delete().in("id", entryIds) : null,
  ].filter((operation) => operation !== null);
  for (const operation of operations) {
    const { error } = await operation;
    if (error) throw new HarnessError(`Exact-ID cleanup failed: ${error.message}`);
  }
  if (matchIds.length) {
    const { error } = await supabase.from("matches").delete().in("id", matchIds);
    if (error) throw new HarnessError(`Exact match cleanup failed: ${error.message}`);
  }
}

async function run() {
  const { pickup, dropZone } = await discoverRoute();
  const route = { pickupId: pickup.id, dropZoneId: dropZone.id };
  for (const user of userNames.filter((name) => name !== "alice")) await catalogFor(user, pickup.id);

  let alice;
  let bob;
  await step("catalog discovery and 1+1 fast offer", async () => {
    alice = await join("alice", route);
    bob = await join("bob", route);
    alice = await queueFor("alice");
    bob = await queueFor("bob");
    assert(alice.status === "offered" && bob.status === "offered", "Both users must receive an offer.");
    assert(alice.match_id !== null && alice.match_id === bob.match_id, "Offer membership must share one match.");
  });
  const matchId = alice.match_id;
  assert(matchId !== null, "Offer did not expose a match ID.");

  await step("both users accept the same offer", async () => {
    await transitionQueue("alice", alice.id, "accept", alice.offer_version);
    await transitionQueue("bob", bob.id, "accept", bob.offer_version);
    const current = await queueFor("bob");
    assert(current.status === "matched", "Second acceptance must assemble the team.");
  });
  await step("membership isolation", async () => {
    const denied = await request("stranger", "GET", `/api/match/${matchId}`);
    assert(denied.status === 403, `Non-member match read must be 403, got ${denied.status}.`);
    const visible = await request("alice", "GET", `/api/match/${matchId}`);
    const parsed = matchSchema.parse(visible.data);
    assert(visible.ok && parsed.members.length === 2, "Member must see the two-entry team.");
  });
  await step("both arrive and one departs", async () => {
    await transitionMatch("alice", matchId, "arrive");
    const arrived = await transitionMatch("bob", matchId, "arrive");
    assert(arrived?.allArrived === true, "Second arrival must make the team ready.");
    const departed = await transitionMatch("alice", matchId, "depart");
    assert(departed?.status === "departed", "Departure must be server-authoritative.");
  });
  await step("settlement create and member read", async () => {
    const actualFare = Math.max(1_000, dropZone.fare.fare_min);
    const created = await request("alice", "POST", `/api/settlement/${matchId}`, {
      bankName: "테스트은행", accountNumber: "123-456-7890", accountHolder: "테스트", actualFare,
    });
    assert(created.ok && created.data?.fare?.actualTotal === actualFare, "Settlement must persist actualFare.");
    const read = await request("bob", "GET", `/api/settlement/${matchId}`);
    assert(read.ok && read.data?.hasAccount === true && read.data?.fare?.actualTotal === actualFare, "Member must read settlement.");
  });
  await step("report idempotency", async () => {
    const body = { match_id: matchId, type: "other", description: "staging e2e idempotency" };
    const first = await request("alice", "POST", "/api/report", body);
    const second = await request("alice", "POST", "/api/report", body);
    assert(first.status === 201 && first.data?.idempotent === false, `First report must create, got ${first.status}.`);
    assert(second.status === 200 && second.data?.idempotent === true, `Second report must be idempotent, got ${second.status}.`);
  });
  await step("offer timeout, resume, and cancel", async () => {
    let carol = await join("carol", route);
    await join("dan", route);
    carol = await queueFor("carol");
    assert(carol.status === "offered" && carol.match_id !== null, "Timeout fixture must be offered.");
    const { error } = await supabase.from("matches").update({ offer_expires_at: new Date(0).toISOString() }).eq("id", carol.match_id);
    if (error) throw new HarnessError(`Clock manipulation failed: ${error.message}`);
    const advanced = await request("carol", "POST", "/api/match/countdown");
    assert(advanced.ok, `Explicit timeout advance failed: HTTP ${advanced.status}`);
    carol = await queueFor("carol");
    assert(carol.status === "paused", "Expired non-response must pause the queue entry.");
    await transitionQueue("carol", carol.id, "resume");
    const resumed = await queueFor("carol");
    assert(resumed.status === "waiting", "Resume must restore waiting state.");
    const cancelled = await transitionQueue("carol", carol.id, "cancel");
    assert(cancelled?.status === "cancelled", "Cancel must end the resumed entry.");
  });
  await step("invalid queue input", async () => {
    const invalid = await request("invalid", "POST", "/api/queue", { party_size: 0, pickup_spot_id: route.pickupId, drop_zone_id: route.dropZoneId, departure_mode: "fast" });
    assert(invalid.status === 400, `Invalid party size must be 400, got ${invalid.status}.`);
  });
}

if (process.argv.includes("--help")) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const confirmLocalWrite = process.argv.includes("--confirm-local-write");
const confirmStagingWrite = process.argv.includes("--confirm-staging-write");
if (confirmLocalWrite === confirmStagingWrite) {
  throw new HarnessError("Choose exactly one write target confirmation flag.");
}
const environment = confirmLocalWrite
  ? loadLocalWriteEnvironment(true)
  : loadStagingWriteEnvironment(true);
const supabase = createClient(environment.supabaseUrl, environment.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  await run();
  process.stdout.write(`PASS ${environment.target} end-to-end flow\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`FAIL ${error instanceof Error ? error.message : "Unknown harness failure"}\n`);
} finally {
  try {
    await cleanup();
    process.stdout.write(`CLEAN entries=${entries.size} matches=${matches.size}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`FAIL cleanup: ${error instanceof Error ? error.message : "Unknown cleanup failure"}\n`);
  }
}
