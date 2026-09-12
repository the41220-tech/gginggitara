import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiMessage, isRecord, relation } from "./api-response";

describe("API response helpers", () => {
  it("reads flat and nested API errors", () => {
    assert.equal(apiMessage({ error: "flat" }, "fallback"), "flat");
    assert.equal(apiMessage({ error: { message: "nested" } }, "fallback"), "nested");
    assert.equal(apiMessage(null, "fallback"), "fallback");
  });

  it("normalizes singular relations returned as an object or array", () => {
    assert.deepEqual(relation({ id: "one" }), { id: "one" });
    assert.deepEqual(relation([{ id: "one" }]), { id: "one" });
    assert.equal(relation([]), null);
  });

  it("rejects arrays as records", () => {
    assert.equal(isRecord([]), false);
    assert.equal(isRecord({}), true);
  });
});
