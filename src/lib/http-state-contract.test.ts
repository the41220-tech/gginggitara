import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function exportedFunction(file: string, name: string, nextName?: string): string {
  const start = file.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? file.indexOf(`export async function ${nextName}`, start + 1) : file.length;
  return file.slice(start, end === -1 ? file.length : end);
}

describe("HTTP state transition contracts", () => {
  it("keeps queue and match GET handlers read-only", () => {
    const queueRoute = source("../app/api/queue/route.ts");
    const matchRoute = source("../app/api/match/[id]/route.ts");

    assert.doesNotMatch(exportedFunction(queueRoute, "GET"), /triggerAllMatches/);
    assert.doesNotMatch(exportedFunction(matchRoute, "GET", "PATCH"), /triggerAllMatches/);
  });

  it("advances deadline transitions through the explicit POST endpoint", () => {
    const waitingPage = source("../app/waiting/[entryId]/page.tsx");
    const teamPage = source("../app/team/[matchId]/page.tsx");

    assert.match(waitingPage, /advanceParticipantMatching/);
    assert.match(teamPage, /advanceParticipantMatching/);
    assert.match(teamPage, /const nextRoute = await advanceParticipantMatching\(\)/);
    assert.match(teamPage, /router\.replace\(nextRoute\);\s*return;/);
  });
});
