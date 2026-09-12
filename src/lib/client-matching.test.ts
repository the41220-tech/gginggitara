import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advanceParticipantMatching } from "./client-matching";

describe("advanceParticipantMatching", () => {
  it("uses an explicit POST to advance deadline state", async () => {
    const calls: Array<{ readonly input: RequestInfo | URL; readonly init?: RequestInit }> = [];
    const nextRoute = await advanceParticipantMatching(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ entry: { id: "entry-1", status: "waiting" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    assert.deepEqual(calls, [{ input: "/api/match/countdown", init: { method: "POST" } }]);
    assert.equal(nextRoute, "/waiting/entry-1");
  });

  it("surfaces a safe API error when advancing fails", async () => {
    await assert.rejects(
      advanceParticipantMatching(async () => new Response(
        JSON.stringify({ error: "Matching is temporarily unavailable." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      )),
      /Matching is temporarily unavailable\./,
    );
  });
});
