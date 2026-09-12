import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { participantRoute } from "./participant-route";

describe("participantRoute", () => {
  it("routes queue states to the waiting entry", () => {
    assert.equal(participantRoute({ id: "entry", status: "waiting", match_id: null }), "/waiting/entry");
    assert.equal(participantRoute({ id: "entry", status: "offered", match_id: "match" }), "/waiting/entry");
    assert.equal(participantRoute({ id: "entry", status: "paused", match_id: null }), "/waiting/entry");
  });

  it("routes assembled states to the team", () => {
    assert.equal(participantRoute({ id: "entry", status: "matched", match_id: "match" }), "/team/match");
    assert.equal(participantRoute({ id: "entry", status: "arrived", match_id: "match" }), "/team/match");
  });

  it("routes terminal states to results and rejects malformed state", () => {
    assert.equal(participantRoute({ id: "entry", status: "expired", match_id: null }), "/result");
    assert.equal(participantRoute({ id: "entry", status: "matched", match_id: null }), null);
    assert.equal(participantRoute(null), null);
  });
});
