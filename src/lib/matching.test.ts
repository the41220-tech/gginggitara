import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldTriggerMatchesAfterTransition, triggerMatchesBestEffort } from "./matching-trigger-policy";

describe("shouldTriggerMatchesAfterTransition", () => {
  it("rematches after every transition that can release waiting entries", () => {
    assert.equal(shouldTriggerMatchesAfterTransition("decline"), true);
    assert.equal(shouldTriggerMatchesAfterTransition("cancel"), true);
    assert.equal(shouldTriggerMatchesAfterTransition("resume"), true);
    assert.equal(shouldTriggerMatchesAfterTransition("accept"), false);
  });
});

describe("triggerMatchesBestEffort", () => {
  it("reports a pending rematch after a committed transition when the engine fails", async () => {
    const pending = await triggerMatchesBestEffort(async () => {
      throw new Error("temporary database failure");
    }, (error: unknown) => error instanceof Error && error.message === "temporary database failure");

    assert.equal(pending, true);
  });

  it("does not hide unexpected programming errors", async () => {
    await assert.rejects(
      triggerMatchesBestEffort(async () => {
        throw new TypeError("unexpected");
      }, (error: unknown) => error instanceof Error && error.message === "temporary database failure"),
      TypeError,
    );
  });
});
