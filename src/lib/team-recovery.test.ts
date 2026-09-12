import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { needsTeamRecovery, recoverTeamRoute } from "./team-recovery";

it("403 after another tab removes match_id recovers through a read-only queue lookup", async () => {
  assert.equal(needsTeamRecovery({ status: 403, ok: false }, { error: "Not a member" }), true);
  const calls: unknown[] = [];
  const route = await recoverTeamRoute("old-team", async (input, init) => {
    calls.push({ input, init });
    return Response.json({ id: "entry-1", status: "waiting", match_id: null });
  });
  assert.equal(route, "/waiting/entry-1");
  assert.deepEqual(calls, [{ input: "/api/queue", init: { method: "GET", cache: "no-store" } }]);
});

it("recovers 404 and cancelled snapshots, but not healthy matches or unrelated errors", () => {
  for (const status of [403, 404]) assert.equal(needsTeamRecovery({ status, ok: false }, null), true);
  assert.equal(needsTeamRecovery({ status: 200, ok: true }, { status: "cancelled" }), true);
  for (const status of [400, 401, 429, 500]) assert.equal(needsTeamRecovery({ status, ok: false }, { status: "cancelled" }), false);
  for (const status of ["assembling", "ready", "departed"]) assert.equal(needsTeamRecovery({ status: 200, ok: true }, { status }), false);
  assert.equal(needsTeamRecovery({ status: 200, ok: true }, null), false);
});

it("uses current participant state for requeued, rematched, terminal, and absent entries", async () => {
  for (const [entry, expected] of [
    [{ id: "entry", status: "paused" }, "/waiting/entry"],
    [{ id: "entry", status: "offered", match_id: "new" }, "/waiting/entry"],
    [{ id: "entry", status: "arrived", match_id: "new" }, "/team/new"],
    [{ id: "entry", status: "matched", match_id: "new" }, "/team/new"],
    [{ id: "entry", status: "noshow" }, "/result"],
    [{ id: "entry", status: "departed" }, "/result"],
    [{ id: "entry", status: "cancelled" }, "/result"],
    [{ id: "entry", status: "expired" }, "/result"],
    [null, "/join"],
  ] as const) {
    assert.equal(await recoverTeamRoute("old-team", async () => Response.json(entry)), expected);
  }
});

it("does not route on failed queue reads, malformed state, or back to the inaccessible team", async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(recoverTeamRoute("old-team", async () => Response.json({ error: "Queue unavailable" }, { status })), /Queue unavailable/);
  }
  for (const payload of [{}, { id: "entry", status: "matched", match_id: null }, { id: "entry", status: "arrived", match_id: "old-team" }]) {
    await assert.rejects(recoverTeamRoute("old-team", async () => Response.json(payload)), /현재 참여 상태/);
  }
  await assert.rejects(recoverTeamRoute("old-team", async () => { throw new Error("offline"); }), /offline/);
  await assert.rejects(recoverTeamRoute("old-team", async () => new Response("bad JSON")), SyntaxError);
});

it("team refresh recovers invalidated membership before parsing or retaining the old match", () => {
  const source = readFileSync(new URL("../app/team/[matchId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(needsTeamRecovery\(response, payload\)\)\s*\{\s*setMatch\(null\)/);
  assert.match(source, /await recoverTeamRoute\(matchId\)/);
  assert.match(source, /await recoverTeamRoute\(matchId\);\s*if \(sequence !== refreshSequenceRef.current\) return;/);
});
