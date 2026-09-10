/**
 * Safe local load test.
 *
 * Phase A is read-only and targets localhost by default. Phase B creates
 * queue entries, so it is disabled unless --run-journey is supplied.
 *
 * Examples:
 *   node scripts/load-test.mjs
 *   node scripts/load-test.mjs --requests 100 --concurrency 10
 *   node scripts/load-test.mjs --run-journey --journey-users 6
 *   node scripts/load-test.mjs --url https://staging.example.test \
 *     --allow-remote-target --run-journey
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_REQUESTS = 60;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_JOURNEY_USERS = 6;
const REQUEST_TIMEOUT_MS = 8_000;

function usage() {
  console.log(`Usage: node scripts/load-test.mjs [options]

Options:
  --url <url>              Target URL (default: ${DEFAULT_BASE_URL})
  --requests <n>           Read-only Phase A requests, 1-500 (default: ${DEFAULT_REQUESTS})
  --concurrency <n>        Phase A concurrent requests, 1-30 (default: ${DEFAULT_CONCURRENCY})
  --run-journey            Explicitly enable mutating Phase B queue journeys
  --journey-users <n>      Phase B participants, 1-30 (default: ${DEFAULT_JOURNEY_USERS})
  --allow-remote-target    Required in addition to --url for non-loopback targets
  --help                   Print this help

Safety:
  Phase A only performs GET requests. Phase B creates queue entries and is
  never run without --run-journey. Any non-loopback URL is rejected unless
  --allow-remote-target is provided; use a dedicated staging environment.`);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function parseBoundedInteger(raw, fallback, label, min, max) {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseTarget(rawTarget) {
  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error("--url must be an absolute HTTP(S) URL.");
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error("--url must be an HTTP(S) URL without credentials.");
  }
  return target;
}

function isLoopback(target) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(target.hostname.toLowerCase());
}

function routeUrl(baseUrl, path, params = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function requestJson(url, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": "kkinggitaja-local-load-test/2.0", ...init.headers },
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  return { response, body, latencyMs };
}

function getCatalogRoute(body) {
  if (!body || typeof body !== "object") return null;
  const pickups = Array.isArray(body.pickup_spots) ? body.pickup_spots : [];
  const routes = Array.isArray(body.drop_zones) ? body.drop_zones : [];
  const pickup = pickups.find((candidate) => candidate && typeof candidate.id === "string");
  const route = routes.find((candidate) => candidate && typeof candidate.id === "string");
  if (!pickup || !route) return null;
  return { pickupId: pickup.id, dropZoneId: route.id };
}

async function discoverRoute(baseUrl) {
  const { response, body } = await requestJson(routeUrl(baseUrl, "/api/catalog"));
  const pickups = body && typeof body === "object" && Array.isArray(body.pickup_spots) ? body.pickup_spots : [];
  const pickup = pickups.find((candidate) => candidate && typeof candidate.id === "string");
  if (!response.ok || !pickup) {
    throw new Error(`Could not discover an active route from /api/catalog (HTTP ${response.status}).`);
  }
  const detail = await requestJson(routeUrl(baseUrl, "/api/catalog", { pickup_spot_id: pickup.id }));
  const route = getCatalogRoute({ pickup_spots: pickups, drop_zones: detail.body?.drop_zones });
  if (!detail.response.ok || !route) {
    throw new Error(`Could not discover an active route from /api/catalog (HTTP ${detail.response.status}).`);
  }
  return route;
}

function percentile(sortedValues, percent) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percent) - 1)];
}

async function runReadOnlyLoad(baseUrl, route, requests, concurrency) {
  const observations = [];
  let nextRequest = 0;

  async function worker() {
    while (nextRequest < requests) {
      nextRequest += 1;
      try {
        const result = await requestJson(routeUrl(baseUrl, "/api/queue/count", {
          pickup_spot_id: route.pickupId,
          drop_zone_id: route.dropZoneId,
        }));
        observations.push({ status: result.response.status, latencyMs: result.latencyMs });
      } catch (error) {
        observations.push({ status: "ERR", latencyMs: REQUEST_TIMEOUT_MS, note: error instanceof Error ? error.message : "unknown error" });
      }
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  const elapsedMs = Math.max(1, performance.now() - startedAt);
  return { observations, elapsedMs };
}

function cookieHeaderFrom(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter((cookie) => cookie !== null);
  return cookies.map((cookie) => cookie.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function runJourney(baseUrl, route, userNumber) {
  const steps = [];
  const create = await requestJson(routeUrl(baseUrl, "/api/queue"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      party_size: 1,
      pickup_spot_id: route.pickupId,
      drop_zone_id: route.dropZoneId,
      departure_mode: "fast",
    }),
  });
  steps.push({ step: "POST /api/queue", status: create.response.status, latencyMs: create.latencyMs });
  const participantCookie = cookieHeaderFrom(create.response);
  if (!create.response.ok || !participantCookie) return { userNumber, steps };

  const sessionHeaders = { Cookie: participantCookie };
  const queue = await requestJson(routeUrl(baseUrl, "/api/queue"), { headers: sessionHeaders });
  steps.push({ step: "GET /api/queue", status: queue.response.status, latencyMs: queue.latencyMs });

  const count = await requestJson(routeUrl(baseUrl, "/api/queue/count", {
    pickup_spot_id: route.pickupId,
    drop_zone_id: route.dropZoneId,
  }));
  steps.push({ step: "GET /api/queue/count", status: count.response.status, latencyMs: count.latencyMs });

  const fare = await requestJson(routeUrl(baseUrl, "/api/fare", {
    pickup_spot_id: route.pickupId,
    drop_zone_id: route.dropZoneId,
    party_size: "1",
  }));
  steps.push({ step: "GET /api/fare", status: fare.response.status, latencyMs: fare.latencyMs });
  return { userNumber, steps };
}

function printReadOnlyReport(result) {
  const statuses = result.observations.map((observation) => observation.status);
  const successful = result.observations.filter((observation) => String(observation.status).startsWith("2"));
  const latencies = successful.map((observation) => observation.latencyMs).sort((left, right) => left - right);
  const failed = result.observations.length - successful.length;
  console.log("\n[Phase A] Read-only route-count load");
  console.log(`  requests: ${result.observations.length}, elapsed: ${Math.round(result.elapsedMs)}ms`);
  console.log(`  throughput: ${(result.observations.length / (result.elapsedMs / 1_000)).toFixed(1)} req/s`);
  console.log(`  successful: ${successful.length}, failed: ${failed}`);
  console.log(`  latency p50/p95/p99: ${percentile(latencies, 0.5) ?? "-"}/${percentile(latencies, 0.95) ?? "-"}/${percentile(latencies, 0.99) ?? "-"}ms`);
  if (failed > 0) console.log(`  failed statuses: ${statuses.filter((status) => !String(status).startsWith("2")).join(", ")}`);
}

function printJourneyReport(journeys) {
  const steps = journeys.flatMap((journey) => journey.steps);
  const failures = steps.filter((step) => !String(step.status).startsWith("2"));
  console.log("\n[Phase B] Mutating participant journeys");
  console.log(`  participants: ${journeys.length}, requests: ${steps.length}, failed: ${failures.length}`);
  if (failures.length > 0) console.log(`  failed steps: ${failures.map((step) => `${step.step} (${step.status})`).join(", ")}`);
  console.log("  Note: each participant follows the HttpOnly Set-Cookie session returned by queue creation.");
}

async function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }
  const target = parseTarget(readFlag("--url") ?? DEFAULT_BASE_URL);
  const runJourneyRequested = process.argv.includes("--run-journey");
  const allowRemoteTarget = process.argv.includes("--allow-remote-target");
  if (!isLoopback(target) && !allowRemoteTarget) {
    throw new Error("Refusing non-loopback target. Add --allow-remote-target only for a dedicated staging environment.");
  }

  const requests = parseBoundedInteger(readFlag("--requests"), DEFAULT_REQUESTS, "--requests", 1, 500);
  const concurrency = parseBoundedInteger(readFlag("--concurrency"), DEFAULT_CONCURRENCY, "--concurrency", 1, 30);
  const journeyUsers = parseBoundedInteger(readFlag("--journey-users"), DEFAULT_JOURNEY_USERS, "--journey-users", 1, 30);
  const baseUrl = target.toString();
  console.log(`Target: ${baseUrl} (${isLoopback(target) ? "loopback" : "remote opt-in"})`);
  console.log("Phase A is read-only. Phase B runs only with --run-journey.");

  const route = await discoverRoute(baseUrl);
  const phaseA = await runReadOnlyLoad(baseUrl, route, requests, concurrency);
  printReadOnlyReport(phaseA);

  if (runJourneyRequested) {
    const journeys = await Promise.all(Array.from({ length: journeyUsers }, (_, index) => runJourney(baseUrl, route, index + 1)));
    printJourneyReport(journeys);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Load test failed.");
  process.exitCode = 1;
});
