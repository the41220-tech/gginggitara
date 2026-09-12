import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationUrl = new URL("../../supabase/migrations/20260912000000_matching_candidate_fairness.sql", import.meta.url);
const matchingSql = readFileSync(migrationUrl, "utf8");

describe("matching SQL safety contracts", () => {
  it("does not truncate a pool to twenty arbitrary FIFO rows", () => {
    assert.doesNotMatch(matchingSql, /ORDER BY qe\.priority_at, qe\.id\s+LIMIT 20\s+FOR UPDATE SKIP LOCKED/);
  });

  it("bounds candidates by equivalent matching signatures", () => {
    assert.match(matchingSql, /PARTITION BY qe\.party_size, qe\.departure_mode,/);
    assert.match(matchingSql, /signature_rank <= 4/);
  });

  it("requires an exact offer version for destructive offered transitions", () => {
    assert.doesNotMatch(matchingSql, /p_offer_version IS NOT NULL AND p_offer_version IS DISTINCT FROM v_entry\.offer_version/);
    assert.match(matchingSql, /p_offer_version IS DISTINCT FROM v_entry\.offer_version/);
  });
});
