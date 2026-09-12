import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectMatchCandidate, type MatchingCandidateEntry } from "./matching-policy";

const NOW = "2026-09-12T07:00:00.000Z";
const FUTURE = "2026-09-12T07:03:00.000Z";
const PAST = "2026-09-12T06:59:00.000Z";

function entry(
  id: string,
  partySize: number,
  departureMode: "fast" | "cheap" = "fast",
  priority = id,
  deadline = FUTURE,
): MatchingCandidateEntry {
  return {
    id,
    partySize,
    departureMode,
    priorityAt: `2026-09-12T06:${priority.padStart(2, "0")}:00.000Z`,
    queueDeadlineAt: deadline,
  };
}

describe("selectMatchCandidate", () => {
  it("matches two fast entries immediately", () => {
    assert.deepEqual(selectMatchCandidate([entry("a", 1, "fast", "01"), entry("b", 1, "fast", "02")], NOW), {
      entryIds: ["a", "b"],
      totalPartySize: 2,
    });
  });

  it("waits for a cheap partial team until its deadline", () => {
    assert.equal(selectMatchCandidate([entry("a", 1, "cheap", "01"), entry("b", 1, "fast", "02")], NOW), null);
    assert.deepEqual(selectMatchCandidate([entry("a", 1, "cheap", "01", PAST), entry("b", 1, "fast", "02")], NOW), {
      entryIds: ["a", "b"],
      totalPartySize: 2,
    });
  });

  it("never splits parties or exceeds four seats", () => {
    assert.deepEqual(selectMatchCandidate([entry("a", 3, "fast", "01"), entry("b", 2, "fast", "02"), entry("c", 1, "fast", "03")], NOW), {
      entryIds: ["a", "c"],
      totalPartySize: 4,
    });
  });

  it("finds a compatible entry beyond the old twenty-row boundary", () => {
    const entries = Array.from({ length: 20 }, (_, index) => entry(`three-${String(index).padStart(2, "0")}`, 3, "fast", String(index)))
      .concat(entry("one-late", 1, "fast", "21"));

    const selected = selectMatchCandidate(entries, NOW);
    assert.equal(selected?.totalPartySize, 4);
    assert.deepEqual(selected?.entryIds, ["three-00", "one-late"]);
  });

  it("prefers the oldest matchable entry and then the fullest team", () => {
    const selected = selectMatchCandidate([
      entry("oldest", 1, "fast", "01"),
      entry("second", 1, "fast", "02"),
      entry("third", 2, "fast", "03"),
    ], NOW);

    assert.deepEqual(selected, { entryIds: ["oldest", "second", "third"], totalPartySize: 4 });
  });
});
